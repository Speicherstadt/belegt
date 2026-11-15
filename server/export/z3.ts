import { type BeschriebeneTabelle, beschreibungXml } from "@firsttris/gobd-kern/beschreibung";
import { formatPruefwert } from "@firsttris/gobd-kern/pruefwert";
import { makeZip } from "client-zip";
import { sql } from "drizzle-orm";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { laden as einstellungenLaden } from "../einstellungen/einstellungen.ts";
import { listen as zeitstempelListen, token as zeitstempelToken } from "../zeitstempel/zeitstempel.ts";
import { FELDER, feldZeilen, ORDNUNG_IM_PROTOKOLL, TAGS, tagZeilen } from "./z3-ordnung.ts";

/**
 * Datenträgerüberlassung (Z3, GoBD Rz. 167): ein ZIP mit den Originalen und je einer CSV für Dokumente, Mails, Tags,
 * eigene Felder und Audit-Log, beschrieben in einer index.xml nach dem Beschreibungsstandard. Ein Dokument gehört zum Zeitraum, wenn
 * seine neueste Einordnung in ihn fällt, sonst sein Eingang. Gelöschte fehlen; ihr Nachweis steht im Audit-Log.
 */

export interface Zeitraum {
  von: string;
  bis: string;
}

const BOM = "﻿";
const ZEILE = "\r\n";

/** RFC 4180 mit Semikolon: Felder mit Trenner, Anführungszeichen oder Umbruch kommen in Anführungszeichen */
const feld = (wert: string | number | null | undefined): string => {
  const text = wert == null ? "" : String(wert);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const spaltenVon = (t: BeschriebeneTabelle) => t.spalten.map((s) => s.name);

export const csv = (kopf: string[], zeilen: (string | number | null)[][]): string =>
  BOM + [kopf, ...zeilen].map((z) => z.map(feld).join(";")).join(ZEILE) + ZEILE;

const sha256Hex = async (text: string | Uint8Array): Promise<string> => {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  return Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
};

/** Name im ZIP: ohne Verzeichnisse und Steuerzeichen, damit kein Eintrag aus seinem Ordner herausführt */
const sichererName = (name: string | null, ersatz: string): string => {
  const bereinigt = (name ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: gerade die Steuerzeichen sollen weg
    .replace(/[\u0000-\u001F\u007F/\\]/g, "_")
    .replace(/^\.+/, "_")
    .trim();
  return bereinigt || ersatz;
};

const DOKUMENTE: BeschriebeneTabelle = {
  path: "dokumente.csv",
  name: "Dokumente",
  beschreibung: "Archivierte Originale mit Einordnung und Aufbewahrungsfrist",
  spalten: [
    { name: "ID", typ: { art: "text" } },
    { name: "Dateiname", typ: { art: "text" } },
    { name: "Typ", typ: { art: "text" } },
    { name: "Größe", typ: { art: "zahl", nachkommastellen: 0 } },
    { name: "SHA-256", typ: { art: "text" } },
    { name: "Eingang", typ: { art: "text" } },
    { name: "Quelle", typ: { art: "text" } },
    { name: "Art", typ: { art: "text" } },
    { name: "Entstanden", typ: { art: "datum" } },
    { name: "Aufbewahren bis", typ: { art: "datum" } },
    { name: "Titel", typ: { art: "text" } },
    { name: "Korrespondent", typ: { art: "text" } },
    { name: "Pfad", typ: { art: "text" } },
    { name: "ASN", typ: { art: "zahl", nachkommastellen: 0 } },
    { name: "Dokumenttyp", typ: { art: "text" } },
    { name: "Tags", typ: { art: "text" } },
  ],
};

const MAILS: BeschriebeneTabelle = {
  path: "mails.csv",
  name: "Mails",
  beschreibung: "Kopf der archivierten Mails; das Original steht als .eml unter dem Pfad des Dokuments",
  spalten: ["Dokument-ID", "Message-ID", "Antwort auf", "Von", "An", "Betreff", "Gesendet"].map((name) => ({
    name,
    typ: { art: "text" as const },
  })),
};

const PROTOKOLL: BeschriebeneTabelle = {
  path: "protokoll.csv",
  name: "Protokoll",
  beschreibung: "Audit-Log des Zeitraums: jeder Eintrag mit dem Hash seines Vorgängers und seinem eigenen (SHA-256)",
  spalten: [
    { name: "Nr", typ: { art: "zahl", nachkommastellen: 0 } },
    ...["Zeitpunkt", "Akteur", "Tabelle", "Zeile", "Aktion", "Neuer Wert", "Hash Vorgänger", "Hash"].map((name) => ({
      name,
      typ: { art: "text" as const },
    })),
  ],
};

type DokumentZeile = {
  id: string;
  dateiname: string | null;
  mime_type: string;
  groesse: string;
  sha256: string;
  eingegangen_am: Date;
  quelle: string;
  art: string | null;
  entstanden: string | null;
  frist_bis: string | null;
  titel: string | null;
  korrespondent: string | null;
  asn: string;
  dokumenttyp: string | null;
  tags: string | null;
};

async function dokumenteImZeitraum({ db }: Umgebung, { von, bis }: Zeitraum): Promise<DokumentZeile[]> {
  return [
    ...(await db.execute<DokumentZeile>(sql`
    select d.id, d.dateiname, d.mime_type, d.groesse, d.sha256, d.eingegangen_am, d.quelle,
           e.art, e.entstanden::text as entstanden, e.frist_bis::text as frist_bis, e.titel, e.korrespondent,
           a.nummer as asn,
           (select ty.name from dokument_dokumenttypen dd join dokumenttypen ty on ty.id = dd.dokumenttyp_id
             where dd.dokument_id = d.id) as dokumenttyp,
           (select string_agg(t.name, ', ' order by lower(t.name)) from dokument_tags dt join tags t on t.id = dt.tag_id
             where dt.dokument_id = d.id) as tags
      from dokumente d
      join archivnummern a on a.dokument_id = d.id
      left join lateral (select * from einordnungen x where x.dokument_id = d.id
                          order by x.erstellt_am desc, x.id desc limit 1) e on true
     where coalesce(e.entstanden, (d.eingegangen_am at time zone 'Europe/Berlin')::date) between ${von}::date and ${bis}::date
       and not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am, d.id`)),
  ];
}

async function mailsCsv({ db }: Umgebung, ids: string[]): Promise<string> {
  const zeilen = ids.length
    ? await db.execute<{
        dokument_id: string;
        message_id: string | null;
        antwort_auf: string | null;
        von: string | null;
        an: string[];
        betreff: string;
        gesendet_am: Date | null;
      }>(sql`
    select dokument_id, message_id, antwort_auf, von, an, betreff, gesendet_am from mails
     where dokument_id = any(array[${sql.join(
       ids.map((id) => sql`${id}`),
       sql`, `,
     )}]::uuid[])
     order by gesendet_am nulls last, dokument_id`)
    : [];
  return csv(
    MAILS.spalten.map((s) => s.name),
    [...zeilen].map((m) => [
      m.dokument_id,
      m.message_id,
      m.antwort_auf,
      m.von,
      m.an.join(", "),
      m.betreff,
      m.gesendet_am ? new Date(m.gesendet_am).toISOString() : null,
    ]),
  );
}

/**
 * Die Zeilen, deren Einträge im Audit-Log zu Dokumenten des Zeitraums gehören: die Dokumente selbst (auch gelöschte,
 * damit ihr Löschnachweis bleibt), ihre Archivnummern, Einordnungen, Löschungen, Mails und Anhänge zwischen zwei
 * solchen Dokumenten.
 * Tags, Dokumenttyp und Feldwerte kommen über ihre dokument_id dazu (ordnungDerFreigabe), auch entfernte.
 */
const zeilenDerFreigabe = ({ von, bis }: Zeitraum) => sql`
    with dok as (select d.id from dokumente d where belegt_dokument_tag(d.id) between ${von}::date and ${bis}::date)
    select id::text from dok
    union all select x.id::text from archivnummern x where x.dokument_id in (select id from dok)
    union all select x.id::text from einordnungen x where x.dokument_id in (select id from dok)
    union all select x.id::text from loeschungen x where x.dokument_id in (select id from dok)
    union all select x.id::text from mails x where x.dokument_id in (select id from dok)
    union all select x.id::text from mail_anhaenge x
               where x.mail_dokument_id in (select id from dok) and x.anhang_dokument_id in (select id from dok)`;

const ordnungDerFreigabe = ({ von, bis }: Zeitraum) => sql`
    (table_name in (${sql.join(
      ORDNUNG_IM_PROTOKOLL.map((t) => sql`${t}`),
      sql`, `,
    )})
     and coalesce(new_value, old_value) ->> 'dokument_id' in (
       select d.id::text from dokumente d where belegt_dokument_tag(d.id) between ${von}::date and ${bis}::date))`;

async function protokollCsv({ db }: Umgebung, { von, bis }: Zeitraum, nurFreigabe: boolean): Promise<string> {
  const zeilen = await db.execute<{
    seq: string;
    at: Date;
    actor: string | null;
    table_name: string;
    row_id: string | null;
    action: string;
    new_value: unknown;
    prev_hash: string;
    row_hash: string;
  }>(sql`
    select seq, at, actor, table_name, row_id, action, new_value,
           encode(prev_hash, 'hex') as prev_hash, encode(row_hash, 'hex') as row_hash
      from audit_log
     where (at at time zone 'Europe/Berlin')::date between ${von}::date and ${bis}::date
       ${
         nurFreigabe
           ? sql`and ((table_name in ('dokumente', 'archivnummern', 'einordnungen', 'loeschungen', 'mails', 'mail_anhaenge')
                       and row_id in (${zeilenDerFreigabe({ von, bis })}))
                   or (table_name = 'seals' and new_value ->> 'row_id' in (${zeilenDerFreigabe({ von, bis })}))
                   or ${ordnungDerFreigabe({ von, bis })})`
           : sql``
       }
     order by seq`);
  return csv(
    PROTOKOLL.spalten.map((s) => s.name),
    [...zeilen].map((a) => [
      Number(a.seq),
      new Date(a.at).toISOString(),
      a.actor,
      a.table_name,
      a.row_id,
      a.action,
      a.new_value == null ? null : JSON.stringify(a.new_value),
      a.prev_hash,
      a.row_hash,
    ]),
  );
}

async function pruefwert({ db }: Umgebung): Promise<string> {
  const [kopf] = await db.execute<{ seq: string; hash: string }>(
    sql`select seq, encode(hash, 'hex') as hash from audit_chain where id = 1`,
  );
  return kopf ? `${formatPruefwert({ seq: Number(kopf.seq), hash: kopf.hash })}\n` : "Das Audit-Log ist leer.\n";
}

/**
 * Baut das ZIP als Stream: Jedes Original wird erst gelesen, wenn das ZIP bei ihm ankommt, und nach seinem Hash
 * geprüft (der Speicher lehnt eine veränderte Datei ab). Fehlt eine Datei oder passt sie nicht, bricht der Export ab,
 * statt ein unvollständiges Archiv als vollständig auszugeben.
 */
export async function z3Export(
  umgebung: Umgebung,
  zeitraum: Zeitraum,
  /** Prüferzugang: im Protokoll nur Einträge zu Dokumenten des Zeitraums, keine Sperren, Regeln oder Zugänge */
  { nurFreigabe = false }: { nurFreigabe?: boolean } = {},
): Promise<ReadableStream<Uint8Array>> {
  const dokumente = await dokumenteImZeitraum(umgebung, zeitraum);
  const ids = dokumente.map((d) => d.id);
  const betrieb = await einstellungenLaden(umgebung.db);
  const stempel = await zeitstempelListen(umgebung.db);
  const pfade = new Map(
    dokumente.map((d) => [d.id, `dokumente/${d.id}/${sichererName(d.dateiname, d.sha256)}`] as const),
  );
  const dateien: { name: string; inhalt: string }[] = [
    {
      name: DOKUMENTE.path,
      inhalt: csv(
        DOKUMENTE.spalten.map((s) => s.name),
        dokumente.map((d) => [
          d.id,
          d.dateiname,
          d.mime_type,
          Number(d.groesse),
          d.sha256,
          new Date(d.eingegangen_am).toISOString(),
          d.quelle,
          d.art,
          d.entstanden,
          d.frist_bis,
          d.titel,
          d.korrespondent,
          pfade.get(d.id) ?? null,
          Number(d.asn),
          d.dokumenttyp,
          d.tags,
        ]),
      ),
    },
    {
      name: MAILS.path,
      inhalt: await mailsCsv(umgebung, ids),
    },
    { name: TAGS.path, inhalt: csv(spaltenVon(TAGS), await tagZeilen(umgebung.db, ids)) },
    { name: FELDER.path, inhalt: csv(spaltenVon(FELDER), await feldZeilen(umgebung.db, ids)) },
    { name: PROTOKOLL.path, inhalt: await protokollCsv(umgebung, zeitraum, nurFreigabe) },
    {
      name: "index.xml",
      inhalt: beschreibungXml({
        lieferant: {
          name: betrieb.firma || "Belegt",
          ort: betrieb.anschrift,
          kommentar: `Zeitraum ${zeitraum.von} bis ${zeitraum.bis}`,
        },
        medium: `Belegt ${zeitraum.von} bis ${zeitraum.bis}`,
        tabellen: [DOKUMENTE, MAILS, TAGS, FELDER, PROTOKOLL],
      }),
    },
    { name: "pruefwert.txt", inhalt: await pruefwert(umgebung) },
    {
      name: "zeitstempel.csv",
      inhalt: csv(
        ["Nr", "Hash", "Zeit", "Dienst", "Seriennummer", "Datei"],
        stempel.map((z) => [z.seq, z.hash, z.zeit.toISOString(), z.dienst, z.seriennummer, `zeitstempel/${z.seq}.tst`]),
      ),
    },
  ];

  const summen: string[] = [];
  async function* eintraege() {
    for (const d of dateien) {
      summen.push(`${await sha256Hex(d.inhalt)}  ${d.name}`);
      yield { name: d.name, input: d.inhalt, lastModified: new Date() };
    }
    // Zeitstempel über die Kette: wer sie prüft, braucht das Token und das Zertifikat des Dienstes
    for (const z of stempel) {
      const t = await zeitstempelToken(umgebung.db, z.id);
      if (!t) continue;
      const bytes = new Uint8Array(t.token);
      summen.push(`${await sha256Hex(bytes)}  zeitstempel/${z.seq}.tst`);
      yield { name: `zeitstempel/${z.seq}.tst`, input: bytes, lastModified: z.zeit };
    }
    for (const d of dokumente) {
      const bytes = await umgebung.speicher.laden(d.sha256);
      const name = pfade.get(d.id)!;
      // Der Hash steht schon versiegelt in der Datenbank; laden hat ihn eben geprüft
      summen.push(`${d.sha256}  ${name}`);
      yield { name, input: new Uint8Array(bytes), lastModified: new Date(d.eingegangen_am) };
    }
    yield { name: "pruefsummen.sha256", input: `${summen.join("\n")}\n`, lastModified: new Date() };
  }
  return makeZip(eintraege(), { buffersAreUTF8: true });
}
