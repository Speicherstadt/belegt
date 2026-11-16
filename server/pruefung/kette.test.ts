import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { zugangAnlegen } from "../test-zugaenge.ts";
import { KETTE_SPERRE, type Kettenpruefung, kettePruefen, letztePruefung, pruefungFaellig } from "./kette.ts";

describe("pruefungFaellig", () => {
  const lauf = (geprueftAm: string) => ({ geprueftAm }) as Kettenpruefung;
  it("ist vor dem ersten Lauf und nach einem Tag fällig, sonst nicht", () => {
    const jetzt = new Date("2026-11-16T12:00:00Z");
    expect(pruefungFaellig(null, jetzt)).toBe(true);
    expect(pruefungFaellig(lauf("2026-11-15T13:00:00Z"), jetzt)).toBe(false);
    expect(pruefungFaellig(lauf("2026-11-15T12:00:00Z"), jetzt)).toBe(true);
  });
});

describe.skipIf(!testDatenbankUrl)("Gespeicherte Prüfung der Kette gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let inhaber: string;
  let kanzlei: string;

  beforeAll(async () => {
    t = await testApp();
    inhaber = (await t.registrieren("anna@example.org")).cookie;
    kanzlei = await zugangAnlegen(t, inhaber, "kanzlei@example.org", { rolle: "steuerberatung" });
  });
  afterAll(() => t?.aufraeumen());

  it("speichert Zeitpunkt, Ergebnis und Zahl der Einträge; die Startseite liest den letzten Lauf", async () => {
    expect(await (await t.anfrage("/api/kette", {}, kanzlei)).json()).toEqual({ lauf: null, zeitstempel: null });
    const lauf = (await kettePruefen(t.db, "system:worker"))!;
    expect(lauf).toMatchObject({ ok: true, befunde: 0, befundListe: [], ausgeloestVon: "system:worker" });
    expect(lauf.eintraege).toBeGreaterThan(0);
    expect((await (await t.anfrage("/api/kette", {}, kanzlei)).json()).lauf).toEqual(lauf);
  });

  it("prüft auf Knopfdruck nur für den Inhaber", async () => {
    expect((await t.anfrage("/api/kette/pruefen", { method: "POST" }, kanzlei)).status).toBe(403);
    const res = await t.anfrage("/api/kette/pruefen", { method: "POST" }, inhaber);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, ausgeloestVon: "nutzer:anna@example.org" });
    expect(await letztePruefung(t.db)).toMatchObject({ ausgeloestVon: "nutzer:anna@example.org" });
  });

  it("startet keinen zweiten Lauf, solange einer prüft; der Knopf hört es mit 409", async () => {
    const zahl = async () => (await t.sql`select count(*)::int as n from kettenpruefungen`)[0]!.n as number;
    const vorher = await zahl();
    // Ein Lauf in einem anderen Prozess hält die Sperre
    const anderer = await t.sql.reserve();
    await anderer`select pg_advisory_lock(hashtextextended(${KETTE_SPERRE}, 0))`;
    try {
      const antworten = await Promise.all(
        Array.from({ length: 5 }, () => t.anfrage("/api/kette/pruefen", { method: "POST" }, inhaber)),
      );
      expect(antworten.map((r) => r.status)).toEqual([409, 409, 409, 409, 409]);
      expect(
        await kettePruefen(t.db, "system:worker", { faelligAm: new Date(Date.now() + 25 * 3_600_000) }),
      ).toBeNull();
      expect(await zahl()).toBe(vorher);
    } finally {
      await anderer`select pg_advisory_unlock(hashtextextended(${KETTE_SPERRE}, 0))`;
      anderer.release();
    }
    expect((await t.anfrage("/api/kette/pruefen", { method: "POST" }, inhaber)).status).toBe(201);
    expect(await zahl()).toBe(vorher + 1);
  });

  it("prüft im Worker nur, wenn der letzte Lauf fällig ist", async () => {
    expect(await kettePruefen(t.db, "system:worker", { faelligAm: new Date() })).toBeNull();
    const spaeter = new Date(Date.now() + 25 * 3_600_000);
    expect(await kettePruefen(t.db, "system:worker", { faelligAm: spaeter })).toMatchObject({ ok: true });
  });

  it("hält einen Befund fest, und der Lauf lässt sich weder ändern noch löschen", async () => {
    // Eine Zeile an den Triggern vorbei geändert (braucht einen Superuser)
    const [d] = await t.sql`select id from dokumente limit 1`;
    if (!d) {
      const form = new FormData();
      form.append("datei", new File([new TextEncoder().encode("%PDF-1.7\n% x\n")], "x.pdf"));
      await t.anfrage("/api/dokumente", { method: "POST", body: form }, inhaber);
    }
    await t.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update dokumente set dateiname = 'gefaelscht.pdf'`;
    });
    const lauf = (await kettePruefen(t.db, "system:worker"))!;
    expect(lauf.ok).toBe(false);
    expect(lauf.befunde).toBeGreaterThan(0);
    expect(lauf.befundListe[0]).toMatchObject({ tabelle: "dokumente" });
    await expect(t.sql`update kettenpruefungen set ok = true, befunde = 0`).rejects.toThrow();
    await expect(t.sql`delete from kettenpruefungen`).rejects.toThrow();
    const [protokoll] = await t.sql`select count(*)::int as n from audit_log where table_name = 'kettenpruefungen'`;
    expect(protokoll?.n).toBe(5);
  });
});
