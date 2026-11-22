import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Platz links in der Kopfleiste der Shell (src/Shell.tsx), neben Suche und Glocke */
export const KOPFZEILE_ID = "kopfzeile-titel";

/**
 * Stellt den Inhalt in die Kopfleiste, auf eine Linie mit Suche und Glocke; ohne Kopfleiste (eingebettet, zweiter
 * Faktor) steht er an seiner Stelle im Inhalt
 */
export function InKopfzeile({ children }: { children: ReactNode }) {
  const [ziel, setZiel] = useState<HTMLElement | null>(null);
  useEffect(() => setZiel(document.getElementById(KOPFZEILE_ID)), []);
  return ziel ? createPortal(children, ziel) : children;
}
