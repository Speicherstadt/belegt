import type { Sichtbereich } from "../shared/rollen.ts";
import type { testApp } from "./test-app.ts";

/*
 * Weitere Zugänge für Tests gegen Postgres: lädt mit dem Cookie des Inhabers ein und registriert mit dem Link, wie es
 * die Oberfläche tut. Gibt das Cookie der neuen Sitzung zurück.
 */
export async function zugangAnlegen(
  t: Awaited<ReturnType<typeof testApp>>,
  inhaber: string,
  email: string,
  zugang:
    | { rolle: "steuerberatung" }
    | { rolle: "pruefer"; zeitraum: { von: string; bis: string } }
    | { rolle: "mitarbeiter"; recht: "lesen" | "bearbeiten"; sichtbereich: Partial<Sichtbereich> },
): Promise<string> {
  const res = await t.anfrage(
    "/api/einladungen",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(zugang) },
    inhaber,
  );
  if (res.status !== 201) throw new Error(`Einladung: ${res.status}`);
  const { pfad } = (await res.json()) as { pfad: string };
  return (await t.registrieren(email, "ein-langes-passwort", { "x-belegt-einladung": pfad.split("/").pop()! })).cookie;
}

/** Ein API-Token im Klartext */
export async function tokenAnlegen(
  t: Awaited<ReturnType<typeof testApp>>,
  inhaber: string,
  recht: "lesen" | "schreiben",
): Promise<string> {
  const res = await t.anfrage(
    "/api/tokens",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: recht, recht }) },
    inhaber,
  );
  return ((await res.json()) as { klartext: string }).klartext;
}
