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
  kompakt = false,
}: {
  dokument: { id: string; mimeType: string; vorschaubild: boolean };
  gross?: boolean;
  /** Mit gross: niedriger, für die kompakten Kacheln */
  kompakt?: boolean;
}) {
  const [kaputt, setKaputt] = useState(false);
  const masse = gross ? (kompakt ? "h-32 w-full" : "h-48 w-full") : "h-14 w-10";
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
  // Ohne Bild ein Blatt mit umgeknickter Ecke und dem Kürzel des Formats, damit Text und Mails nicht wie leer aussehen
  const farbe = FARBE[kuerzel(dokument.mimeType)] ?? "bg-zinc-600";
  return (
    <span aria-hidden="true" className={`${masse} relative flex items-center justify-center`}>
      <span
        className={`${gross ? (kompakt ? "h-28 w-20" : "h-40 w-32") : "h-14 w-10"} relative flex flex-col items-center justify-center gap-1.5 border border-border bg-bg shadow-sm [clip-path:polygon(0_0,75%_0,100%_18%,100%_100%,0_100%)]`}
      >
        {gross && (
          <span className="flex w-16 flex-col gap-1.5">
            <span className="h-1 rounded bg-border" />
            <span className="h-1 w-3/4 rounded bg-border" />
            <span className="h-1 rounded bg-border" />
          </span>
        )}
        <span
          className={`${farbe} rounded px-1 font-semibold text-white ${gross ? "px-2 py-0.5 text-xs" : "text-xs leading-none"}`}
        >
          {kuerzel(dokument.mimeType)}
        </span>
      </span>
    </span>
  );
}

/** Farbe des Kürzels je Format; dunkel genug für weiße Schrift (WCAG AA) */
const FARBE: Record<string, string> = {
  EML: "bg-sky-700",
  DOC: "bg-blue-700",
  XLS: "bg-green-700",
  PPT: "bg-orange-700",
  TXT: "bg-zinc-600",
  PDF: "bg-red-700",
  XML: "bg-violet-700",
};
