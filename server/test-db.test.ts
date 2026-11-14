import { afterAll, describe, expect, it } from "vitest";
import { testDatenbank, testDatenbankUrl } from "./test-db.ts";

describe.skipIf(!testDatenbankUrl)("Testdatenbank", () => {
  let sql: Awaited<ReturnType<typeof testDatenbank>> | undefined;
  afterAll(() => sql?.end());

  it("legt je Worker eine eigene, frische Datenbank neben der Vorlage an", async () => {
    sql = await testDatenbank();
    const [zeile] = await sql`select current_database() as name`;
    expect(zeile!.name).toMatch(/_\d+$/);
    await sql`create table probe (id int)`;
    sql.end();
    sql = await testDatenbank();
    expect(await sql`select to_regclass('probe') as t`).toEqual([{ t: null }]);
  });
});
