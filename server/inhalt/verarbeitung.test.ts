import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Stand der Verarbeitung gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfrage = (pfad: string, init: RequestInit = {}) => t.anfrage(pfad, init, cookie);

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
  });
  afterAll(() => t?.aufraeumen());

  it("zählt Dokumente, deren Text noch nicht gelesen ist, und nimmt sie heraus, sobald der Text da ist", async () => {
    const leer = (await (await anfrage("/api/verarbeitung")).json()) as { textOffen: number };
    expect(leer.textOffen).toBe(0);
    const f = new FormData();
    f.append("datei", new File(["Hallo"], "neu.txt", { type: "text/plain" }));
    const { id } = (await (await anfrage("/api/dokumente", { method: "POST", body: f })).json()) as { id: string };
    expect(((await (await anfrage("/api/verarbeitung")).json()) as { textOffen: number }).textOffen).toBe(1);
    await t.sql`insert into inhalte (dokument_id, text) values (${id}, 'Hallo')`;
    expect(((await (await anfrage("/api/verarbeitung")).json()) as { textOffen: number }).textOffen).toBe(0);
  });
});
