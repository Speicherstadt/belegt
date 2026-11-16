import { describe, expect, it } from "vitest";
import type { Zugaenge } from "./api-zugang.ts";
import { ausgeschlossenBei } from "./rollen.ts";

const bereich = (ohneTags: string[]) => ({
  tags: [],
  dokumenttypen: [],
  korrespondenten: [],
  ohneTags,
  ohneOrdnung: false,
});

describe("ausgeschlossenBei", () => {
  it("zählt Mitarbeiter und offene Einladungen, die den Tag ausschließen; entzogene und eingelöste nicht", () => {
    const zugang = (sichtbereich: ReturnType<typeof bereich> | null, entzogenAm: string | null = null) => ({
      id: "x",
      email: "m@example.org",
      rolle: "mitarbeiter" as const,
      zeitraumVon: null,
      zeitraumBis: null,
      recht: "lesen" as const,
      sichtbereich,
      entzogenAm,
      erstelltAm: "2026-01-01",
      zweiFaktor: { totp: false, passkeys: 0 },
    });
    const einladung = (
      sichtbereich: ReturnType<typeof bereich>,
      eingeloestAm: string | null,
      zurueckgezogenAm = null,
    ) => ({
      id: "e",
      rolle: "mitarbeiter" as const,
      zeitraumVon: null,
      zeitraumBis: null,
      recht: "lesen" as const,
      sichtbereich,
      erstelltAm: "2026-01-01",
      gueltigBis: "2999-01-01T00:00:00Z",
      eingeloestAm,
      eingeloestVon: null,
      zurueckgezogenAm,
    });
    const z: Zugaenge = {
      zugaenge: [zugang(bereich(["p"])), zugang(bereich(["p"]), "2026-02-01"), zugang(bereich(["q"])), zugang(null)],
      einladungen: [einladung(bereich(["p"]), null), einladung(bereich(["p"]), "2026-01-02")],
    };
    expect(ausgeschlossenBei("p", z, new Date("2026-03-01"))).toBe(2);
    expect(ausgeschlossenBei("r", z, new Date("2026-03-01"))).toBe(0);
  });
});
