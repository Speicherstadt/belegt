import { describe, expect, it } from "vitest";
import { DARSTELLUNG_SKRIPT, MODUS_KEY, modusAnwenden, modusLesen } from "./darstellung.ts";

const speicher = (wert: string | null) => ({ getItem: (k: string) => (k === MODUS_KEY ? wert : null) });

describe("Darstellung", () => {
  it("liest die Wahl und fällt sonst auf System zurück", () => {
    expect(modusLesen(speicher("dunkel"))).toBe("dunkel");
    expect(modusLesen(speicher("hell"))).toBe("hell");
    expect(modusLesen(speicher(null))).toBe("system");
    expect(modusLesen(speicher("lila"))).toBe("system");
    expect(
      modusLesen({
        getItem: () => {
          throw new Error("gesperrt");
        },
      }),
    ).toBe("system");
  });

  it("setzt data-theme für hell und dunkel und nimmt es für System weg", () => {
    const wurzel = { dataset: {} as DOMStringMap } as HTMLElement;
    modusAnwenden("dunkel", wurzel);
    expect(wurzel.dataset.theme).toBe("dark");
    modusAnwenden("hell", wurzel);
    expect(wurzel.dataset.theme).toBe("light");
    modusAnwenden("system", wurzel);
    expect(wurzel.dataset.theme).toBeUndefined();
  });

  it("wendet im Inline-Skript dieselbe Wahl an, bevor die Seite gezeichnet wird", () => {
    const lauf = (wert: string | null, gesperrt = false) => {
      const documentElement = { dataset: {} as DOMStringMap };
      const localStorage = {
        getItem: (k: string) => {
          if (gesperrt) throw new Error("gesperrt");
          return k === MODUS_KEY ? wert : null;
        },
      };
      new Function("document", "localStorage", DARSTELLUNG_SKRIPT)({ documentElement }, localStorage);
      return documentElement.dataset.theme;
    };
    expect(lauf("dunkel")).toBe("dark");
    expect(lauf("hell")).toBe("light");
    expect(lauf("system")).toBeUndefined();
    expect(lauf("<script>")).toBeUndefined();
    expect(lauf("dunkel", true)).toBeUndefined();
  });
});
