import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";
import { opensslDa, testTsa } from "./tsa-test.ts";
import { zeitstempelSetzen } from "./zeitstempel.ts";

describe.skipIf(!testDatenbankUrl || !opensslDa)("Zeitstempel über die Kette gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let tsa: Awaited<ReturnType<typeof testTsa>>;
  let cookie: string;
  const hochladen = async (inhalt: string) => {
    const form = new FormData();
    form.append("datei", new File([inhalt], `${inhalt}.txt`));
    await t.anfrage("/api/dokumente", { method: "POST", body: form }, cookie);
  };

  beforeAll(async () => {
    tsa = await testTsa();
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    await hochladen("erstes");
  });
  afterAll(async () => {
    await t?.aufraeumen();
    await tsa?.schliessen();
  });

  it("stempelt den Kopf der Kette, prüfbar mit openssl, und nur wenn etwas dazukam", async () => {
    const [kopf] = await t.sql`select seq::int, encode(hash, 'hex') as hash from audit_chain`;
    const z = await zeitstempelSetzen(t.db, tsa.url);
    expect(z?.seq).toBe(kopf!.seq);
    const [zeile] = await t.sql`select hash, token from zeitstempel`;
    expect(zeile!.hash).toBe(kopf!.hash);
    expect(tsa.pruefen(zeile!.token, kopf!.hash)).toBe(true);

    // Der Eintrag des Zeitstempels selbst ist nichts Neues
    expect(await zeitstempelSetzen(t.db, tsa.url)).toBeNull();
    await hochladen("zweites");
    expect(await zeitstempelSetzen(t.db, tsa.url, { abstandStunden: 24 })).toBeNull();
    expect(await zeitstempelSetzen(t.db, tsa.url)).not.toBeNull();
    expect(tsa.zustand.anfragen).toBe(2);
  });

  it("ist versiegelt: weder ändern noch löschen", async () => {
    await expect(t.sql`update zeitstempel set dienst = 'anders'`).rejects.toThrow();
    await expect(t.sql`delete from zeitstempel`).rejects.toThrow();
  });

  it("nennt Zeitstempel in Liste, Prüfbericht und Z3-Export, mit dem Token zum Herunterladen", async () => {
    const liste = await (await t.anfrage("/api/zeitstempel", {}, cookie)).json();
    expect(liste).toHaveLength(2);
    const token = await t.anfrage(`/api/zeitstempel/${liste[0].id}/token`, {}, cookie);
    expect(token.headers.get("content-disposition")).toBe(`attachment; filename="zeitstempel-${liste[0].seq}.tst"`);
    const bytes = new Uint8Array(await token.arrayBuffer());
    expect(tsa.pruefen(bytes, liste[0].hash)).toBe(true);

    const { bericht } = await (await t.anfrage("/api/pruefung", {}, cookie)).json();
    expect(bericht.zeitstempel).toMatchObject({ seq: liste[0].seq, dienst: tsa.url });
    const doku = JSON.stringify(await (await t.anfrage("/api/verfahrensdoku", {}, cookie)).json());
    expect(doku).toContain(`Zeitstempeldienst nach RFC 3161 bestätigen (${tsa.url})`);

    const heute = new Date().toISOString().slice(0, 10);
    const zip = unzipSync(
      new Uint8Array(await (await t.anfrage(`/api/export?von=${heute}&bis=${heute}`, {}, cookie)).arrayBuffer()),
    );
    expect(new TextDecoder().decode(zip["zeitstempel.csv"]!)).toContain(liste[0].hash);
    const datei = zip[`zeitstempel/${liste[0].seq}.tst`]!;
    expect(createHash("sha256").update(datei).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
