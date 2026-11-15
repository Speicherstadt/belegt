import { useState } from "react";
import { vorschaubildUrl } from "../lib/api.ts";

/** Kürzel des Formats für den Platzhalter, aus dem Typ der Datei */
export function kuerzel(mimeType: string): string {
  if (mimeType === "message/rfc822") return "EML";
  if (mimeType.includes("wordprocessing") || mimeType.includes("msword") || mimeType.includes("opendocument.text"))
    return "DOC";
  if (mimeType.includes("spreadsheet") || mimeType.includes("ms-excel")) return "XLS";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "PPT";
  if (mimeType === "text/plain") return "TXT";
  const typ = mimeType.split("/")[1] ?? "";
  return /^[a-z0-9]{2,5}$/i.test(typ) ? typ.toUpperCase() : "?";
}

/**
 * Vorschaubild der ersten Seite, erst geladen, wenn es sichtbar wird; ohne Bild (Mails, Text, noch nicht erzeugt) ein
 * Platzhalter mit dem Kürzel des Formats. Schmückend: Der Name steht daneben, deshalb ohne Alternativtext.
 */
export function Thumbnail({
  dokument,
  gross = false,
}: {
  dokument: { id: string; mimeType: string; vorschaubild: boolean };
  gross?: boolean;
}) {
  const [kaputt, setKaputt] = useState(false);
  const masse = gross ? "h-48 w-full" : "h-14 w-10";
  if (dokument.vorschaubild && !kaputt)
    return (
      <img
        src={vorschaubildUrl(dokument.id)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setKaputt(true)}
        data-testid="vorschaubild"
        className={`${masse} rounded border border-border bg-white object-cover object-top`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`${masse} flex items-center justify-center rounded border border-border bg-subtle font-semibold text-[10px] text-muted`}
    >
      {kuerzel(dokument.mimeType)}
    </span>
  );
}
