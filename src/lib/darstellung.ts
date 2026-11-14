/**
 * Hell, dunkel oder nach dem Gerät; die Wahl liegt nur im Browser (localStorage), nicht auf dem Server.
 * „System“ setzt kein data-theme, dann entscheidet prefers-color-scheme in styles.css, auch wenn sich das Gerät später
 * umstellt. Eine einbettende Seite setzt data-theme selbst (EmbedBridge) und hat damit das letzte Wort.
 */
export const MODI = ["system", "hell", "dunkel"] as const;
export type Modus = (typeof MODI)[number];

export const MODUS_KEY = "belegt.darstellung";
export const MODUS_VORGABE: Modus = "system";

const THEME: Record<Modus, "light" | "dark" | null> = { system: null, hell: "light", dunkel: "dark" };

/** Läuft als Inline-Skript im <head> (vite.config.ts), bevor die Seite gezeichnet wird, damit nichts aufblitzt */
export const DARSTELLUNG_SKRIPT = `(function(){try{var t=${JSON.stringify(THEME)}[localStorage.getItem(${JSON.stringify(MODUS_KEY)})];if(t)document.documentElement.dataset.theme=t}catch(e){}})();`;

export function modusLesen(speicher: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Modus {
  try {
    const wert = speicher?.getItem(MODUS_KEY);
    return MODI.find((m) => m === wert) ?? MODUS_VORGABE;
  } catch {
    return MODUS_VORGABE;
  }
}

const zuhoerer = new Set<() => void>();

/** Für useSyncExternalStore */
export function modusAbonnieren(f: () => void) {
  zuhoerer.add(f);
  return () => {
    zuhoerer.delete(f);
  };
}

export function modusAnwenden(modus: Modus, wurzel: HTMLElement = document.documentElement) {
  const theme = THEME[modus];
  if (theme) wurzel.dataset.theme = theme;
  else delete wurzel.dataset.theme;
}

export function modusSpeichern(modus: Modus, speicher: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    speicher?.setItem(MODUS_KEY, modus);
  } catch {
    // Privater Modus o. Ä.: gilt dann nur bis zum Neuladen
  }
  modusAnwenden(modus);
  for (const f of zuhoerer) f();
}
