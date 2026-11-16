import type postgres from "postgres";

/*
 * Getrennte Datenbankrollen (docs/betrieb.md#getrennte-datenbankrollen): Server, Worker und SMTP-Journal melden sich
 * mit einer App-Rolle an, die die Tabellen nicht besitzt. Nur der Migrationsschritt nutzt die Eigentümerverbindung
 * (MIGRATION_DATABASE_URL) und vergibt danach die Rechte neu. So kann die App weder Trigger abschalten noch Tabellen
 * ändern oder leeren; was sie schreiben darf, prüfen weiterhin die Trigger.
 */

type Leser = postgres.Sql | postgres.TransactionSql;

const REPLIKA =
  "Der Replikationsmodus dieser Sitzung ist replica: Sperr-, Siegel- und Audit-Trigger laufen nicht (Vorgabe der Rolle oder Datenbank korrigieren).";

export interface Identitaet {
  rolle: string;
  anmeldung: string;
  datenbank: string;
  replikation: string;
}

/** Wirksame Rechte einer Tabelle für die angemeldete Rolle */
export interface TabellenRechte {
  tabelle: string;
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
  trigger: boolean;
}

/** Was die Anmeldung über Lesen und Schreiben hinaus darf; die Oberfläche übersetzt die Codes */
export const PROBLEME = {
  rollenwechsel: "Die Sitzung nutzt einen Rollenwechsel statt einer eigenen Anmeldung.",
  replika: REPLIKA,
  admin: "Die Anmeldung oder eine erreichbare Rolle hat administrative Rechte (etwa SUPERUSER).",
  eigentuemer: "Die Anmeldung ist Eigentümer der Datenbank oder ihrer Tabellen.",
  anlegen: "Die Anmeldung kann Objekte in der Datenbank anlegen.",
  temporaer: "Die Anmeldung kann temporäre Tabellen anlegen und damit Namen in Triggerfunktionen überdecken.",
  replikation: "Die Anmeldung kann den Replikationsmodus und damit die Trigger abschalten.",
  dateien: "Die Anmeldung hat Zugriff auf Dateien oder Programme des Datenbankservers.",
  leeren: "Die Anmeldung kann Tabellen leeren (TRUNCATE) oder Trigger anlegen.",
  vorgaben:
    "Für die Anmeldung sind Vorgaben per ALTER ROLE … SET hinterlegt (etwa search_path); der Migrationsschritt setzt sie zurück.",
  schreiben:
    "Die Anmeldung darf Tabellen schreiben, die sie nur lesen oder ergänzen soll (etwa über pg_write_all_data oder ein Recht für PUBLIC).",
} as const;

export type Problem = keyof typeof PROBLEME;

/** Die Befunde als Text für Log, Fehlermeldungen und Verfahrensdokumentation */
export const problemText = (probleme: Problem[]) => probleme.map((p) => PROBLEME[p]).join(" ");

export interface Datenbankzugriff {
  rolle: string;
  anmeldung: string;
  /** Keine Rechte über Lesen und Schreiben hinaus: getrennte Rollen sind wirksam */
  eingeschraenkt: boolean;
  probleme: Problem[];
  tabellen: TabellenRechte[];
}

/** Eine echte Anmeldung statt SET ROLE: RESET ROLE darf keinen Eigentümerzugang öffnen */
async function identitaet(sql: Leser): Promise<Identitaet> {
  const [z] = await sql<Identitaet[]>`select current_user as rolle, session_user as anmeldung,
    current_database() as datenbank, current_setting('session_replication_role') as replikation`;
  return z!;
}

/**
 * Alle Rollen, die die Anmeldung per SET erreicht, und was sie zusammen dürfen. Attribute wie SUPERUSER gelten nur für
 * die Sitzungsrolle, Eigentum und Rechte auch über Vererbung.
 * https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE
 * https://www.postgresql.org/docs/16/role-membership.html
 * https://www.postgresql.org/docs/16/runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE (nur Superuser oder mit
 * ausdrücklichem Recht auf den Parameter)
 * Eigentümer kommen aus pg_shdepend, nicht aus einer Liste von Objekttypen
 * (https://www.postgresql.org/docs/16/catalog-pg-shdepend.html), ohne Large Objects: Die darf jede Rolle anlegen
 * (lo_create), und ein eigenes gibt keine Macht über Tabellen; sonst verhinderte die App ihren nächsten Start.
 */
async function zugriffFuer(sql: Leser, wer: Identitaet): Promise<Datenbankzugriff> {
  const [r] = await sql<
    {
      admin: boolean;
      eigentuemer: boolean;
      anlegen: boolean;
      temporaer: boolean;
      replikation: boolean;
      dateien: boolean;
      vorgaben: boolean;
    }[]
  >`with erreichbar as (
      select r.* from pg_roles r join pg_roles a on a.rolname = ${wer.anmeldung}
       where pg_has_role(a.oid, r.oid, 'SET')
    ), eigentuemer as (
      select datdba as oid from pg_database where datname = current_database()
      union select refobjid from pg_shdepend where refclassid = 'pg_authid'::regclass and deptype = 'o'
        and dbid = (select oid from pg_database where datname = current_database())
        and classid <> 'pg_largeobject'::regclass
    ) select
      exists(select 1 from erreichbar where rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls)
        or exists(select 1 from erreichbar r cross join pg_auth_members m
                   where m.admin_option and pg_has_role(r.oid, m.member, 'USAGE')) as admin,
      exists(select 1 from erreichbar r cross join eigentuemer e where pg_has_role(r.oid, e.oid, 'USAGE')) as eigentuemer,
      exists(select 1 from erreichbar r where has_database_privilege(r.oid, current_database(), 'CREATE'))
        or exists(select 1 from erreichbar r cross join pg_namespace s where has_schema_privilege(r.oid, s.oid, 'CREATE')) as anlegen,
      exists(select 1 from erreichbar r where has_database_privilege(r.oid, current_database(), 'TEMP')) as temporaer,
      exists(select 1 from erreichbar r
              where has_parameter_privilege(r.oid, 'session_replication_role', 'SET,ALTER SYSTEM')) as replikation,
      exists(select 1 from erreichbar r cross join pg_roles f
              where f.rolname in ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program')
                and pg_has_role(r.oid, f.oid, 'USAGE')) as dateien,
      exists(select 1 from pg_db_role_setting s join pg_roles a on a.oid = s.setrole
              where a.rolname = ${wer.anmeldung}
                and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))) as vorgaben`;
  // Über alle per SET erreichbaren Rollen: pg_write_all_data oder ein Recht für PUBLIC zählen mit
  const tabellen = await sql<TabellenRechte[]>`
    with erreichbar as (
      select r.oid from pg_roles r join pg_roles a on a.rolname = ${wer.anmeldung} where pg_has_role(a.oid, r.oid, 'SET')
    ) select c.relname as tabelle,
           bool_or(has_table_privilege(r.oid, c.oid, 'SELECT')) as select, bool_or(has_table_privilege(r.oid, c.oid, 'INSERT')) as insert,
           bool_or(has_table_privilege(r.oid, c.oid, 'UPDATE')) as update, bool_or(has_table_privilege(r.oid, c.oid, 'DELETE')) as delete,
           bool_or(has_table_privilege(r.oid, c.oid, 'TRUNCATE')) as truncate, bool_or(has_table_privilege(r.oid, c.oid, 'TRIGGER')) as trigger
      from pg_class c cross join erreichbar r
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     group by c.relname
     order by c.relname`;
  const soll = new Map((await tabellenRechte(sql)).map((t) => [t.tabelle, t.rechte]));
  const probleme: Problem[] = [];
  if (wer.rolle !== wer.anmeldung) probleme.push("rollenwechsel");
  if (wer.replikation === "replica") probleme.push("replika");
  if (r!.admin) probleme.push("admin");
  else if (r!.eigentuemer) probleme.push("eigentuemer");
  else {
    if (r!.anlegen) probleme.push("anlegen");
    if (r!.temporaer) probleme.push("temporaer");
    if (r!.replikation) probleme.push("replikation");
    if (r!.dateien) probleme.push("dateien");
    if (r!.vorgaben) probleme.push("vorgaben");
    if (tabellen.some((t) => t.truncate || t.trigger)) probleme.push("leeren");
    const zuViel = (t: TabellenRechte) =>
      (["insert", "update", "delete"] as const).some((r) => t[r] && !soll.get(t.tabelle)?.includes(r));
    if (tabellen.some(zuViel)) probleme.push("schreiben");
  }
  return { rolle: wer.rolle, anmeldung: wer.anmeldung, eingeschraenkt: probleme.length === 0, probleme, tabellen };
}

/** Die wirksamen Rechte der eigenen Anmeldung; keine Verbindungsadresse */
export async function zugriffLesen(sql: Leser): Promise<Datenbankzugriff> {
  return zugriffFuer(sql, await identitaet(sql));
}

/** Für Log und Oberfläche: Warnung, wenn die App mit mehr Rechten läuft als nötig, sonst null */
export function zugriffWarnung(z: Datenbankzugriff): string | null {
  if (z.eingeschraenkt) return null;
  return `Warnung: Die Datenbankanmeldung ${z.anmeldung} hat mehr Rechte als nötig (${problemText(z.probleme)}) Getrennte Rollen einrichten: docs/betrieb.md, „Getrennte Datenbankrollen“.`;
}

/**
 * Prüft vor der ersten Migration, dass App und Migration zwei verschiedene echte Anmeldungen an derselben Datenbank
 * sind. Dieselbe Datenbank belegt die Sperre, die die Migration schon hält: pg_locks darf jede Rolle lesen
 * (https://www.postgresql.org/docs/16/view-pg-locks.html).
 */
export async function appAnmeldungPruefen(
  eigentuemer: postgres.Sql,
  app: postgres.Sql,
  sperre: number,
): Promise<Identitaet> {
  const migration = await identitaet(eigentuemer);
  const a = await identitaet(app);
  if (a.rolle !== a.anmeldung || a.anmeldung === migration.anmeldung)
    throw new Error("DATABASE_URL und MIGRATION_DATABASE_URL müssen verschiedene Datenbankanmeldungen sein.");
  // Eine Vorgabe der Rolle wirkt auch ohne das Recht, den Parameter selbst zu setzen
  if (a.replikation === "replica") throw new Error(REPLIKA);
  const [pid] = await eigentuemer<{ pid: number }[]>`select pg_backend_pid() as pid`;
  const [beweis] = await app<{ gleich: boolean }[]>`select exists(select 1 from pg_locks
    where locktype = 'advisory' and pid = ${pid!.pid} and granted and objsubid = 1
      and classid = (${sperre}::bigint >> 32)::oid and objid = (${sperre}::bigint & 4294967295)::oid
      and database = (select oid from pg_database where datname = current_database())) as gleich`;
  if (a.datenbank !== migration.datenbank || !beweis!.gleich)
    throw new Error("DATABASE_URL und MIGRATION_DATABASE_URL müssen auf dieselbe Datenbank zeigen.");
  return a;
}

/**
 * Tabellen, die die App nur liest: Die Anmeldung versiegelter Tabellen geschieht nur in Migrationen, den Stand der
 * Sicherung trägt der Backup-Container mit dem Eigentümerzugang ein. Audit-Log, Siegel und Kopf der Kette schreiben
 * nur ihre Trigger, deren Funktionen mit den Rechten des Eigentümers laufen (drizzle/0047_audit_nur_trigger.sql).
 */
export const NUR_LESEN = ["sealed_tables", "backup_status", "audit_log", "seals", "audit_chain"];

/**
 * Einstellungen in genau einer Zeile, die die App ändert, aber nie löscht: Ohne die Zeile fiele etwa die Pflicht zum
 * zweiten Faktor still weg (server/zugang/zwei-faktor.ts)
 */
export const OHNE_LOESCHEN = ["anmeldung_einstellungen", "benachrichtigung_einstellungen"];

/**
 * Rechte je Tabelle aus ihren Triggern: Wer per belegt_append_only nur ergänzt werden darf (versiegelte Tabellen ohne
 * Festschreibungsspalte, Freigaben, Postfach-Aktionen …), bekommt kein UPDATE oder DELETE. TRUNCATE, TRIGGER und
 * REFERENCES gibt es nie.
 * tgtype: Bit 8 DELETE, Bit 16 UPDATE (src/include/catalog/pg_trigger.h).
 */
async function tabellenRechte(tx: Leser): Promise<{ tabelle: string; rechte: string[] }[]> {
  const zeilen = await tx<{ tabelle: string; ohne_update: boolean; ohne_delete: boolean }[]>`
    select c.relname as tabelle,
           coalesce(bool_or(p.proname = 'belegt_append_only' and t.tgtype & 16 <> 0), false) as ohne_update,
           coalesce(bool_or(p.proname = 'belegt_append_only' and t.tgtype & 8 <> 0), false) as ohne_delete
      from pg_class c
      left join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal
      left join pg_proc p on p.oid = t.tgfoid
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     group by c.relname
     order by c.relname`;
  return zeilen.map((z) => {
    if (NUR_LESEN.includes(z.tabelle)) return { tabelle: z.tabelle, rechte: ["select"] };
    const ohneDelete = z.ohne_delete || OHNE_LOESCHEN.includes(z.tabelle);
    return {
      tabelle: z.tabelle,
      rechte: ["select", "insert", ...(z.ohne_update ? [] : ["update"]), ...(ohneDelete ? [] : ["delete"])],
    };
  });
}

/**
 * Nach jeder Migration unter ihrer Sperre, idempotent: erst alles entziehen, dann genau das Nötige vergeben. Rollen und
 * Passwörter verwaltet der Betreiber. TEMP und CREATE für PUBLIC entfallen, weil eine temporäre Tabelle oder eine
 * eigene Funktion unqualifizierte Namen in Triggerfunktionen überdecken könnte
 * (https://www.postgresql.org/docs/16/ddl-schemas.html#DDL-SCHEMAS-PATH).
 */
export async function rechteVergeben(eigentuemer: postgres.Sql, app: Identitaet): Promise<Datenbankzugriff> {
  return eigentuemer.begin(async (tx) => {
    const rolle = tx(app.anmeldung);
    await vorgabenZuruecksetzen(tx, app);
    await tx`revoke create on schema public from public`;
    await tx`revoke temporary on database ${tx(app.datenbank)} from public`;
    await tx`grant connect on database ${tx(app.datenbank)} to ${rolle}`;
    await tx`grant usage on schema public to ${rolle}`;
    await tx`revoke all on all tables in schema public from ${rolle}`;
    for (const t of await tabellenRechte(tx))
      await tx.unsafe(`grant ${t.rechte.join(", ")} on table public.${quote(t.tabelle)} to ${quote(app.anmeldung)}`);
    await tx`revoke all on all sequences in schema public from ${rolle}`;
    await tx`grant usage on all sequences in schema public to ${rolle}`;
    // Den Stand der Migrationen prüft der Server beim Start (migrieren.ts), ohne die übrigen Spalten
    await tx`grant usage on schema drizzle to ${rolle}`;
    await tx`grant select (created_at) on drizzle.__drizzle_migrations to ${rolle}`;
    // Tabellen anmelden darf nur die Migration; ohnehin scheiterte es am fehlenden Eigentum
    await tx`revoke execute on function belegt_seal_table(regclass, text), belegt_audit_table(regclass, text[]) from public`;
    // Ein Eigentümer ohne Superuser gibt nur seine eigenen Funktionen frei
    const freigaben = await tx<{ befehl: string }[]>`
      select format('grant execute on function %s to %I', p.oid::regprocedure, ${app.anmeldung}::text) as befehl
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and pg_has_role(current_user, p.proowner, 'USAGE')
         and p.proname not in ('belegt_seal_table', 'belegt_audit_table')`;
    for (const f of freigaben) await tx.unsafe(f.befehl);
    const zugriff = await zugriffFuer(tx, app);
    if (!zugriff.eingeschraenkt)
      throw new Error(`Die App-Anmeldung ist nicht eingeschränkt: ${problemText(zugriff.probleme)}`);
    return zugriff;
  });
}

/**
 * Vorgaben der App-Rolle per ALTER ROLE … SET (pg_db_role_setting) wirken bei jeder Anmeldung: ein Suchpfad ohne public,
 * nur lesende Transaktionen oder eine andere Isolationsstufe legen Belegt lahm. Die App kann sie für sich selbst setzen;
 * der Migrationsschritt nimmt sie zurück und nennt die Namen, nie die Werte. session_replication_role bricht schon vorher
 * ab (appAnmeldungPruefen), weil nur ein Superuser sie setzen kann.
 * https://www.postgresql.org/docs/16/catalog-pg-db-role-setting.html
 */
async function vorgabenZuruecksetzen(tx: postgres.TransactionSql, app: Identitaet): Promise<void> {
  const vorgaben = await tx<{ alle: boolean; namen: string[] }[]>`
    select s.setdatabase = 0 as alle, array(select split_part(c, '=', 1) from unnest(s.setconfig) c) as namen
      from pg_db_role_setting s join pg_roles a on a.oid = s.setrole
     where a.rolname = ${app.anmeldung}
       and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))`;
  for (const v of vorgaben) {
    if (v.alle) await tx`alter role ${tx(app.anmeldung)} reset all`;
    else await tx`alter role ${tx(app.anmeldung)} in database ${tx(app.datenbank)} reset all`;
    console.warn(`Vorgaben der App-Anmeldung ${app.anmeldung} zurückgesetzt: ${v.namen.join(", ")}`);
  }
}

/** Bezeichner in doppelten Anführungszeichen, wie quote_ident */
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
