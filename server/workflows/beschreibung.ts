import { asc } from "drizzle-orm";
import type { Datenbank } from "../db/client.ts";
import { dokumenttypen, felder, tags } from "../db/schema.ts";
import { type Aktion, type Bedingungen, type Workflow, workflowsListen } from "./workflows.ts";

/*
 * Aktive Workflows in Worten für die Verfahrensdokumentation (GoBD Rz. 151 ff.: auch automatisierte Abläufe gehören
 * beschrieben): Auslöser, Bedingungen und Aktionen mit den heutigen Namen von Tags, Typen und Feldern. Deutsch, weil
 * die Verfahrensdokumentation für die deutsche Finanzverwaltung ist.
 */

const QUELLE: Record<string, string> = {
  upload: "hochgeladen",
  mail: "Mail",
  ordner: "Eingangsordner",
  api: "Schnittstelle",
  abgeleitet: "abgeleitet",
  import: "Import",
};

const ART: Record<string, string> = {
  buecher: "Bücher",
  zoll: "Zoll",
  beleg: "Buchungsbeleg",
  geschaeftsbrief: "Geschäftsbrief",
  sonstige: "sonstige Unterlage",
  freiwillig: "freiwillig",
  frei: "frei",
};

type Namen = { tag: (id: string) => string; typ: (id: string) => string; feld: (id: string) => string };

function bedingungen(b: Bedingungen, n: Namen): string {
  const teile = [
    b.quellen?.length ? `Quelle ${b.quellen.map((q) => QUELLE[q] ?? q).join(" oder ")}` : "",
    b.dateinameEnthaelt ? `Dateiname enthält „${b.dateinameEnthaelt}“` : "",
    b.betreffEnthaelt ? `Betreff enthält „${b.betreffEnthaelt}“` : "",
    b.absender ? `Absender ${b.absender}` : "",
    b.domain ? `Domain ${b.domain}` : "",
    b.anhangTyp ? `Anhang vom Typ ${b.anhangTyp}` : "",
    b.textEnthaelt ? `Text enthält „${b.textEnthaelt}“` : "",
    b.mimeTyp ? `Dateityp ${b.mimeTyp}` : "",
    b.tags?.length ? `hat Tag ${b.tags.map(n.tag).join(", ")}` : "",
    b.dokumenttyp ? `Dokumenttyp ${b.dokumenttyp === "ohne" ? "keiner" : n.typ(b.dokumenttyp)}` : "",
    b.postfach ? `aus Postfach „${b.postfach}“` : "",
    b.unterordner ? `aus Unterordner „${b.unterordner}“` : "",
  ].filter(Boolean);
  return teile.length ? teile.join(", ") : "jedes Dokument";
}

function aktion(a: Aktion, n: Namen): string {
  switch (a.art) {
    case "tagsHinzu":
      return `Tag ${a.tags.map(n.tag).join(", ")} hinzufügen`;
    case "tagsWeg":
      return `Tag ${a.tags.map(n.tag).join(", ")} entfernen`;
    case "dokumenttyp":
      return `Dokumenttyp „${n.typ(a.dokumenttyp)}“ setzen`;
    case "feld":
      return `Feld „${n.feld(a.feldId)}“ setzen`;
    case "einordnen":
      return `ohne Bestätigung einordnen als ${ART[a.als] ?? a.als} (Entstehung: ${a.entstanden === "erechnung" ? "Datum der E-Rechnung, sonst Eingang" : "Tag des Eingangs"})`;
    case "webhook":
      return "Webhook-Ereignis dokument.workflow";
    case "notiz":
      return "Notiz anlegen";
  }
}

/** Ein Satz je aktivem Workflow, in der Reihenfolge der Ausführung */
export async function workflowsBeschreiben(db: Datenbank): Promise<{ texte: string[]; ordnenEin: boolean }> {
  const aktive = (await workflowsListen(db)).filter((w: Workflow) => w.aktiv);
  if (!aktive.length) return { texte: [], ordnenEin: false };
  const [t, ty, f] = await Promise.all([
    db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name)),
    db.select({ id: dokumenttypen.id, name: dokumenttypen.name }).from(dokumenttypen),
    db.select({ id: felder.id, name: felder.name }).from(felder),
  ]);
  const name = (liste: { id: string; name: string }[]) => (id: string) =>
    liste.find((x) => x.id === id)?.name ?? "(gelöscht)";
  const n: Namen = { tag: name(t), typ: name(ty), feld: name(f) };
  return {
    texte: aktive.map(
      (w) =>
        `Workflow „${w.name}“: wenn ein Dokument ${w.ausloeser === "eingang" ? "aufgenommen" : "eingeordnet"} wird und ${bedingungen(w.bedingungen, n)}, dann ${w.aktionen.map((a) => aktion(a, n)).join("; ")}${w.anhalten ? "; die folgenden Workflows laufen dann nicht" : ""}`,
    ),
    ordnenEin: aktive.some((w) => w.aktionen.some((a) => a.art === "einordnen")),
  };
}
