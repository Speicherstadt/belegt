import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatenbank, testDatenbankUrl } from "../../server/test-db.ts";

/*
 * Backup, Restore und Test-Restore (deploy/backup) gegen den Test-Postgres: echte pg_dump/pg_restore, echte Prüfung von
 * Belegt (server/pruefung/cli.ts), restic als Nachbau (restic-attrappe.sh), damit sich eine Sicherung gezielt verändern
 * lässt. Das echte restic läuft in der CI im Job „Container bauen und starten“.
 */
const hatWerkzeuge = ["pg_dump", "pg_restore", "psql", "createdb", "dropdb", "flock", "sha256sum"].every(
  (p) => spawnSync("sh", ["-c", `command -v ${p}`]).status === 0,
);

describe.skipIf(!testDatenbankUrl || !hatWerkzeuge)("Backup und Test-Restore (Postgres)", { timeout: 120_000 }, () => {
  const hier = import.meta.dirname;
  const wurzel = join(hier, "..", "..");
  let admin: postgres.Sql;
  let ordner: string;
  let env: Record<string, string>;
  let db: string;
  const ziel = `belegt_restore_ziel_${process.pid}`;

  const sha = (inhalt: string) => createHash("sha256").update(inhalt).digest("hex");
  const datei = (inhalt: string) => join(env.DOKUMENTE_DIR!, sha(inhalt).slice(0, 2), sha(inhalt));

  async function dokumentAnlegen(inhalt: string) {
    mkdirSync(join(env.DOKUMENTE_DIR!, sha(inhalt).slice(0, 2)), { recursive: true });
    writeFileSync(datei(inhalt), inhalt);
    await admin.begin(async (tx) => {
      await tx`select set_config('belegt.actor', 'test:backup', true)`;
      await tx`insert into dokumente (sha256, groesse, mime_type, dateiname, quelle)
        values (${sha(inhalt)}, ${inhalt.length}, 'text/plain', 'beleg.txt', 'upload')`;
    });
  }

  function skript(name: string, args: string[] = [], extra: Record<string, string> = {}, eingabe?: string) {
    const r = spawnSync("bash", [join(hier, name), ...args], {
      env: { ...env, ...extra },
      encoding: "utf8",
      input: eingabe,
      timeout: 90_000,
    });
    return { status: r.status, aus: `${r.stdout}\n${r.stderr}` };
  }

  const status = () =>
    admin<{ art: string; ok: boolean; meldung: string; ziel: string | null; zeitplan: string | null }[]>`
      select art, ok, meldung, ziel, zeitplan from backup_status order by id`;
  const snapshots = () => readdirSync(join(env.RESTIC_REPOSITORY!, "snapshots")).sort();
  const letzterSnapshot = () => join(env.RESTIC_REPOSITORY!, "snapshots", snapshots().at(-1)!, "data");

  beforeAll(async () => {
    admin = await testDatenbank();
    ordner = mkdtempSync(join(tmpdir(), "belegt-backup-"));
    const bin = join(ordner, "bin");
    mkdirSync(bin);
    symlinkSync(join(hier, "restic-attrappe.sh"), join(bin, "restic"));
    const u = new URL(testDatenbankUrl!);
    db = decodeURIComponent(u.pathname.slice(1));
    env = {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: ordner,
      TMPDIR: ordner,
      PGHOST: u.hostname,
      PGPORT: u.port || "5432",
      PGUSER: decodeURIComponent(u.username),
      PGPASSWORD: decodeURIComponent(u.password),
      PGDATABASE: db,
      // Zugangsdaten im Ziel dürfen nicht in backup_status landen
      RESTIC_REPOSITORY: join(ordner, "repo"),
      RESTIC_PASSWORD: "test",
      STATE_DIR: join(ordner, "state"),
      DOKUMENTE_DIR: join(ordner, "dokumente"),
      BELEGT_APP: wurzel,
      BACKUP_HOST: "test",
      BACKUP_TIME: "03:15",
      RESTORE_CHECK_DAYS: "7",
      TZ: "Europe/Berlin",
    };
    mkdirSync(env.STATE_DIR!);
    mkdirSync(env.DOKUMENTE_DIR!);
    await dokumentAnlegen("Rechnung 1");
    await dokumentAnlegen("Rechnung 2");
  });

  afterAll(async () => {
    if (admin) {
      await admin`drop database if exists ${admin(ziel)} with (force)`;
      await admin.end();
    }
    if (ordner) rmSync(ordner, { recursive: true, force: true });
  });

  it("sichert Datenbank und Originale, trägt Backup und den ersten Test-Restore als bestanden ein", async () => {
    const r = skript("backup.sh");
    expect(r.status, r.aus).toBe(0);
    expect(readFileSync(join(env.STATE_DIR!, "status"), "utf8")).toMatch(/^ok /);
    const data = letzterSnapshot();
    expect(readdirSync(join(data, env.STATE_DIR!, "stage")).sort()).toEqual([
      "belegt.dump",
      "belegt.dump.sha256",
      "dokumente",
    ]);
    expect(existsSync(join(data, datei("Rechnung 1")))).toBe(true);
    // Nach dem Lauf liegt der Dump nicht mehr im Arbeitsverzeichnis
    expect(readdirSync(join(env.STATE_DIR!, "stage"))).toEqual([]);
    const s = await status();
    expect(s.map((z) => `${z.art}=${z.ok}`)).toEqual(["backup=true", "restore_check=true"]);
    expect(s[0]!.zeitplan).toBe("täglich um 03:15, Test-Restore alle 7 Tage");
    expect(s[1]!.meldung).toContain("2 Dokumente");
    expect(s[1]!.meldung).toContain("2 Originale gegen ihren Hash geprüft");
    expect(s[1]!.meldung).toContain("gleich der laufenden Datenbank");
    // Die Wegwerf-Datenbank ist wieder weg
    expect(await admin`select datname from pg_database where datname like ${`${db}_restore_check%`}`).toEqual([]);
    // Das Audit-Log nennt den Container als Akteur
    expect(await admin`select actor from audit_log where table_name = 'backup_status'`).toEqual([
      { actor: "backup" },
      { actor: "backup" },
    ]);
  });

  it("macht beim nächsten Backup innerhalb der Frist keinen Test-Restore", async () => {
    expect(skript("backup.sh").status).toBe(0);
    expect((await status()).map((z) => z.art)).toEqual(["backup", "restore_check", "backup"]);
  });

  it("meldet ein verändertes Original in der Sicherung", async () => {
    writeFileSync(join(letzterSnapshot(), datei("Rechnung 2")), "verändert");
    const r = skript("restore-check.sh", ["latest"]);
    expect(r.status).not.toBe(0);
    const [letzter] = (await status()).slice(-1);
    expect(letzter).toMatchObject({ art: "restore_check", ok: false });
    expect(letzter!.meldung).toContain("Datei passt nicht zu ihrem Hash");
  });

  it("meldet ein fehlendes Original in der Sicherung", async () => {
    rmSync(join(letzterSnapshot(), datei("Rechnung 1")));
    const r = skript("restore-check.sh", ["latest"]);
    expect(r.status).not.toBe(0);
    expect((await status()).at(-1)!.meldung).toContain("Datei fehlt");
  });

  it("meldet einen Dump, der nicht zu seiner Prüfsumme passt", async () => {
    const dump = join(letzterSnapshot(), env.STATE_DIR!, "stage", "belegt.dump");
    writeFileSync(dump, Buffer.concat([readFileSync(dump), Buffer.from("x")]));
    expect(skript("restore-check.sh", ["latest"]).status).not.toBe(0);
    expect((await status()).at(-1)!.meldung).toContain("Prüfsumme");
  });

  it("meldet ein Repository mit Fehlern", async () => {
    writeFileSync(join(env.RESTIC_REPOSITORY!, "kaputt"), "");
    try {
      expect(skript("restore-check.sh").status).not.toBe(0);
      expect((await status()).at(-1)!).toMatchObject({ ok: false, meldung: expect.stringContaining("errors") });
    } finally {
      rmSync(join(env.RESTIC_REPOSITORY!, "kaputt"));
    }
  });

  it("stellt Datenbank und Originale in eine frische Datenbank und ein leeres Verzeichnis wieder her", async () => {
    expect(skript("backup.sh", [], { RESTORE_CHECK_DAYS: "0" }).status).toBe(0);
    const dokumente = join(ordner, "wiederhergestellt");
    const r = skript(
      "restore.sh",
      ["latest"],
      { PGDATABASE: ziel, DOKUMENTE_DIR: dokumente, DOKUMENTE_UID: String(process.getuid?.() ?? 0) },
      "ja\n",
    );
    expect(r.status, r.aus).toBe(0);
    expect(readFileSync(join(dokumente, sha("Rechnung 1").slice(0, 2), sha("Rechnung 1")), "utf8")).toBe("Rechnung 1");
    // Die wiederhergestellte Datenbank besteht die Prüfung von Belegt, Dateien eingeschlossen
    const pruefung = spawnSync("bun", [join(wurzel, "server/pruefung/cli.ts")], {
      env: { ...env, PGDATABASE: ziel, DOCUMENTS_DIR: dokumente },
      encoding: "utf8",
    });
    expect(pruefung.status, pruefung.stderr).toBe(0);
    expect(JSON.parse(pruefung.stdout)).toMatchObject({ ok: true, dokumente: 2, dateienGeprueft: 2 });
  });

  it("ersetzt nichts, solange jemand mit der Datenbank verbunden ist", async () => {
    const offen = postgres(testDatenbankUrl!.replace(`/${db}`, `/${ziel}`), { max: 1, onnotice: () => {} });
    try {
      await offen`select 1`;
      const r = skript("restore.sh", ["latest"], { PGDATABASE: ziel, DOKUMENTE_DIR: join(ordner, "egal") }, "ja\n");
      expect(r.status).not.toBe(0);
      expect(r.aus).toContain("noch Verbindungen offen");
      expect(existsSync(join(ordner, "egal"))).toBe(false);
    } finally {
      await offen.end();
    }
  });

  it("ersetzt nichts ohne ausdrückliches ja", () => {
    const r = skript("restore.sh", ["latest"], { PGDATABASE: ziel, DOKUMENTE_DIR: join(ordner, "egal") }, "nein\n");
    expect(r.status).not.toBe(0);
    expect(r.aus).toContain("Abgebrochen");
  });

  it("prüft die Sicherung vor dem Ersetzen und ersetzt bei Befunden nichts, außer mit --trotz-befunden", async () => {
    expect(skript("backup.sh", [], { RESTORE_CHECK_DAYS: "0" }).status).toBe(0);
    writeFileSync(join(letzterSnapshot(), datei("Rechnung 1")), "verändert");
    const zielDb = () => postgres(testDatenbankUrl!.replace(`/${db}`, `/${ziel}`), { max: 1, onnotice: () => {} });
    const vorher = zielDb();
    try {
      await vorher`select set_config('belegt.actor', 'test:restore', false)`;
      await vorher`update einstellungen set firma = 'Stand vor dem Restore'`;
    } finally {
      await vorher.end();
    }
    const dokumente = join(ordner, "nach-befund");
    const extra = { PGDATABASE: ziel, DOKUMENTE_DIR: dokumente, DOKUMENTE_UID: String(process.getuid?.() ?? 0) };
    const r = skript("restore.sh", ["latest"], extra, "ja\n");
    expect(r.status).not.toBe(0);
    expect(r.aus).toContain("Datei passt nicht zu ihrem Hash");
    expect(r.aus).toContain("nichts geändert");
    const danach = zielDb();
    try {
      expect(await danach`select firma from einstellungen`).toEqual([{ firma: "Stand vor dem Restore" }]);
    } finally {
      await danach.end();
    }
    expect(existsSync(dokumente) ? readdirSync(dokumente) : []).toEqual([]);
    expect(await admin`select datname from pg_database where datname = ${`${ziel}_restore`}`).toEqual([]);
    // Ausdrücklich trotzdem: etwa wenn nur ein Teil der Originale beschädigt ist
    const trotz = skript("restore.sh", ["latest", "--trotz-befunden"], extra, "ja\n");
    expect(trotz.status, trotz.aus).toBe(0);
    expect(trotz.aus).toContain("Datei passt nicht zu ihrem Hash");
  });

  it("sichert bei Originalen in S3 nur die Datenbank", async () => {
    const r = skript("backup.sh", [], { S3_ENDPUNKT: "https://s3.example", RESTORE_CHECK_DAYS: "0" });
    expect(r.status, r.aus).toBe(0);
    const data = letzterSnapshot();
    expect(readFileSync(join(data, env.STATE_DIR!, "stage", "dokumente"), "utf8").trim()).toBe("s3");
    expect(existsSync(join(data, env.DOKUMENTE_DIR!))).toBe(false);
    expect((await status()).at(-1)!.meldung).toContain("S3-Bucket");
  });

  it("trägt ein fehlgeschlagenes Backup mit Meldung ein und meldet es dem Healthcheck", async () => {
    const r = skript("backup.sh", [], { DOKUMENTE_DIR: join(ordner, "fehlt") });
    expect(r.status).not.toBe(0);
    expect(readFileSync(join(env.STATE_DIR!, "status"), "utf8")).toMatch(/^fehler /);
    expect((await status()).at(-1)!).toMatchObject({ art: "backup", ok: false });
    expect((await status()).at(-1)!.meldung).toContain("Die Originale liegen nicht unter");
  });

  it("meldet eine an den Triggern vorbei veränderte Zeile im Test-Restore", async () => {
    // Eine Manipulation mit Superuser-Rechten, wie sie nur der Betreiber könnte; danach wieder zurück
    const vorher = await admin<{ dateiname: string }[]>`select dateiname from dokumente limit 1`;
    await admin.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update dokumente set dateiname = 'gefaelscht.txt' where dateiname = ${vorher[0]!.dateiname}`;
    });
    expect(skript("backup.sh", [], { RESTORE_CHECK_DAYS: "0" }).status).toBe(0);
    expect(skript("restore-check.sh").status).not.toBe(0);
    const letzter = (await status()).at(-1)!;
    expect(letzter).toMatchObject({ art: "restore_check", ok: false });
    expect(letzter.meldung).toContain("Inhalt passt nicht zum Siegel");
  });

  it("nimmt Zugangsdaten aus dem Ziel für backup_status heraus", () => {
    const bash = spawnSync("bash", ["-c", `. ${join(hier, "backup-status.sh")}; ziel_ohne_zugang`], {
      encoding: "utf8",
      env: { ...env, RESTIC_REPOSITORY: "rest:https://nutzer:geheim@backup.example/belegt" },
    });
    expect(bash.stdout.trim()).toBe("rest:https://backup.example/belegt");
  });

  // restic liest die Adresse mit url.Parse von Go, das die Anmeldung am letzten @ vor dem Pfad trennt
  it("nimmt auch ein Passwort mit @ ganz aus dem Ziel heraus, in backup_status und im Log des Zeitplans", () => {
    const repo = "rest:https://nutzer:ge@heim@backup.example/belegt";
    const bash = spawnSync("bash", ["-c", `. ${join(hier, "backup-status.sh")}; ziel_ohne_zugang`], {
      encoding: "utf8",
      env: { ...env, RESTIC_REPOSITORY: repo },
    });
    expect(bash.stdout.trim()).toBe("rest:https://backup.example/belegt");
    // Der Zeitplan nennt das Ziel beim Start; sleep beendet ihn nach der ersten Zeile
    const zeitplan = spawnSync("bash", [join(hier, "entrypoint.sh")], {
      encoding: "utf8",
      env: { ...env, RESTIC_REPOSITORY: repo, BACKUP_TIME: "03:15" },
      timeout: 3_000,
    });
    expect(zeitplan.stdout).toContain("nach rest:https://backup.example/belegt");
    expect(zeitplan.stdout).not.toContain("heim");
  });
});
