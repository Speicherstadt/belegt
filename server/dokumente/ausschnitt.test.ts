import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testApp } from "../test-app.ts";
import { testDatenbankUrl } from "../test-db.ts";

describe.skipIf(!testDatenbankUrl)("Ausschnitt aus dem Text bei einer Suche gegen Postgres", () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let cookie: string;
  const anfrage = (pfad: string) => t.anfrage(pfad, {}, cookie);
  const hoch = async (name: string, text: string) => {
    const f = new FormData();
    f.append("datei", new File([name], name));
    const { id } = (await (await t.anfrage("/api/dokumente", { method: "POST", body: f }, cookie)).json()) as {
      id: string;
    };
    await t.sql`insert into inhalte (dokument_id, text) values (${id}, ${text})`;
    return id;
  };

  beforeAll(async () => {
    t = await testApp();
    cookie = (await t.registrieren("anna@example.org")).cookie;
    await hoch(
      "police.pdf",
      "Sehr geehrte Frau Muster, anbei Ihre neue Police. Die Hausratversicherung beginnt am 1. März und kostet 12 Euro.",
    );
    await hoch("brief.pdf", "Ein Schreiben ohne das gesuchte Wort.");
  });
  afterAll(() => t?.aufraeumen());

  it("liefert zur Suche einen Ausschnitt mit dem Treffer zwischen den Markierungen", async () => {
    const liste = (await (await anfrage("/api/dokumente?suche=Hausratversicherung")).json()) as {
      dateiname: string;
      ausschnitt: string | null;
    }[];
    expect(liste.map((d) => d.dateiname)).toEqual(["police.pdf"]);
    expect(liste[0]!.ausschnitt).toContain("\u0002Hausratversicherung\u0003");
    expect(liste[0]!.ausschnitt!.length).toBeLessThan(400);
  });

  it("ohne Suche oder ohne Treffer im Text gibt es keinen Ausschnitt", async () => {
    const alle = (await (await anfrage("/api/dokumente")).json()) as { ausschnitt: string | null }[];
    expect(alle.every((d) => d.ausschnitt === null)).toBe(true);
    // Treffer nur im Dateinamen: kein Ausschnitt aus dem Text
    const name = (await (await anfrage("/api/dokumente?suche=brief")).json()) as { ausschnitt: string | null }[];
    expect(name[0]!.ausschnitt).toBeNull();
  });
});
