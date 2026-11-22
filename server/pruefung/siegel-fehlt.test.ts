import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Fehlendes Siegel aus der Kette gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;

  beforeAll(async () => {
    t = await testApp();
    const { cookie } = await t.registrieren("anna@example.org");
    const form = new FormData();
    form.append("datei", new File(["%PDF-1.7\n% x\n"], "x.pdf"));
    expect((await t.anfrage("/api/dokumente", { method: "POST", body: form }, cookie)).status).toBe(201);
  });
  afterAll(() => t?.aufraeumen());

  it("meldet ein Siegel, das im Audit-Log steht, aber an den Triggern vorbei gelöscht wurde", async () => {
    const [s] = await t.sql<{ id: string; table_name: string; row_id: string }[]>`
      select id::text, table_name, row_id::text from seals order by id limit 1`;
    const [eintrag] = await t.sql<{ seq: string }[]>`
      select seq from audit_log where table_name = 'seals' and row_id = ${s!.id} and action = 'INSERT'`;
    // Braucht einen Superuser, wie jeder Eingriff an den Triggern vorbei
    await t.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from seals where id = ${s!.id}`;
    });
    const befunde = await t.sql`
      select art, tabelle, zeile, seq from belegt_integrity_problems(100)
       where befund = 'Siegel fehlt, steht aber im Audit-Log'`;
    expect(befunde).toEqual([{ art: "siegel", tabelle: s!.table_name, zeile: s!.row_id, seq: eintrag!.seq }]);
  });
});
