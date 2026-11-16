import { datenbankRollenText } from "@firsttris/gobd-kern/verfahrensdoku";
import { describe, expect, it } from "vitest";
import type { Datenbankzugriff, TabellenRechte } from "../db/rollen.ts";
import { rechteBeschreiben } from "./datenbank.ts";

const tabelle = (name: string, rechte: Partial<TabellenRechte>): TabellenRechte => ({
  tabelle: name,
  select: true,
  insert: false,
  update: false,
  delete: false,
  truncate: false,
  trigger: false,
  ...rechte,
});

describe("Datenbankrollen in der Verfahrensdokumentation", () => {
  it("nennt die App-Rolle und die Tabellen je Art", () => {
    const z: Datenbankzugriff = {
      rolle: "belegt_app",
      anmeldung: "belegt_app",
      eingeschraenkt: true,
      probleme: [],
      tabellen: [
        tabelle("sealed_tables", {}),
        tabelle("audit_log", { insert: true }),
        tabelle("audit_chain", { update: true }),
        tabelle("einstellungen", { insert: true, update: true, delete: true }),
      ],
    };
    const { absatz, liste } = rechteBeschreiben(z);
    expect(absatz).toContain("„belegt_app“");
    // Der Satz des Kerns, dahinter was nur Belegt betrifft
    expect(
      absatz.startsWith(datenbankRollenText({ anmeldung: "belegt_app", eingeschraenkt: true, probleme: [] })),
    ).toBe(true);
    expect(absatz).toContain(
      "Mit dieser Anmeldung arbeiten Server, Worker und SMTP-Journal; Tabellen leeren kann sie auch nicht.",
    );
    expect(absatz).toContain("Die Migrationen laufen beim Start mit der Eigentümerrolle");
    expect(liste).toEqual([
      "Nur lesen (1): sealed_tables",
      "Nur ergänzen (lesen und einfügen) (1): audit_log",
      "Fortschreiben nur über Trigger (lesen und ändern) (1): audit_chain",
      "Lesen und schreiben, Sperren prüfen die Trigger (1): einstellungen",
    ]);
  });

  it("nennt eine Anmeldung mit zu vielen Rechten ohne Liste", () => {
    const { absatz, liste } = rechteBeschreiben({
      rolle: "belegt",
      anmeldung: "belegt",
      eingeschraenkt: false,
      probleme: ["eigentuemer"],
      tabellen: [],
    });
    expect(absatz).toContain("mehr Rechten als nötig");
    expect(absatz).toContain("Die Anmeldung ist Eigentümer der Datenbank oder ihrer Tabellen.");
    expect(absatz).toContain("Getrennte Datenbankrollen für Anwendung und Migrationen sind noch einzurichten");
    expect(liste).toEqual([]);
  });
});
