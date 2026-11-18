import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { anzahl } from "../../shared/zahl.ts";
import { entschluesseln } from "../crypto.ts";
import { mitAkteur } from "../db/akteur.ts";
import { importe, paperlessQuellen } from "../db/schema.ts";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { MAX_UPLOAD } from "../grundlagen.ts";
import { type Abfragen, paperlessApi } from "./api.ts";
import {
  AKTEUR,
  dokumentUebernehmen,
  erledigt,
  fehlerFesthalten,
  fehlerMeldung,
  type Vorbereitet,
  vorbereiten,
} from "./kern.ts";
import { exportEntfernen, exportPfad } from "./laeufe.ts";
import { istManifest, jsonLesen, manifestLesen } from "./manifest.ts";
import { zipOeffnen } from "./zip.ts";

/*
 * Ein Lauf im Worker: der älteste, der wartet oder (nach einem Neustart) noch läuft. Er geht Dokument für Dokument vor,
 * überspringt, was schon ein Ergebnis hat, und fragt vor jedem Dokument, ob jemand abbrechen will. Fällt Paperless-ngx
 * aus oder lehnt das Token ab, endet der Lauf mit Fehler; ein neuer Lauf derselben Quelle macht dort weiter.
 */

export interface ImportOptionen {
  schluessel: Buffer;
  /** Ordner für hochgeladene Exporte, den Server und Worker teilen */
  importOrdner?: string;
  /** HTTP zu Paperless-ngx; Tests geben eigenes */
  abfragen?: Abfragen;
}

/** Größte Manifest-Datei; darüber hilft ein Export mit --split-manifest */
const MAX_MANIFEST = 500 * 1024 * 1024;

type Ende = "fertig" | "abgebrochen";

const meldung = (err: unknown) => (err instanceof Error ? fehlerMeldung(err) : String(err)).slice(0, 1000);

async function abbruchGewuenscht(umgebung: Umgebung, id: string): Promise<boolean> {
  const [z] = await umgebung.db.select({ von: importe.abbrechenVon }).from(importe).where(eq(importe.id, id));
  return !!z?.von;
}

const setzen = (umgebung: Umgebung, id: string, werte: Partial<typeof importe.$inferInsert>) =>
  mitAkteur(umgebung.db, AKTEUR, (tx) => tx.update(importe).set(werte).where(eq(importe.id, id)));

async function apiLauf(umgebung: Umgebung, lauf: typeof importe.$inferSelect, o: ImportOptionen): Promise<Ende> {
  const [q] = await umgebung.db.select().from(paperlessQuellen).where(eq(paperlessQuellen.id, lauf.quelleId!));
  if (!q) throw new Error("Quelle fehlt");
  const api = paperlessApi({
    url: q.url,
    token: entschluesseln(o.schluessel, q.ciphertext).toString(),
    abfragen: o.abfragen,
  });
  const { felder, namen, anzahl } = await api.bestand();
  const v = await vorbereiten(umgebung.db, felder);
  await setzen(umgebung, lauf.id, { gesamt: anzahl, hinweise: v.hinweise });
  const fertig = await erledigt(umgebung.db, lauf.id);
  for (let n = 1; ; n++) {
    const { dokumente, weiter } = await api.seite(n, namen);
    for (const d of dokumente) {
      if (fertig.has(d.id)) continue;
      if (await abbruchGewuenscht(umgebung, lauf.id)) return "abgebrochen";
      const original = await api.original(d).catch((err: Error) => {
        // Ohne Verbindung oder ohne gültiges Token scheitert jedes weitere Dokument genauso: der Lauf endet
        if (/nicht erreichbar|Token/.test(err.message)) throw err;
        return err;
      });
      if (original instanceof Error) await fehlerFesthalten(umgebung.db, lauf.id, d, original.message);
      else await dokumentUebernehmen(umgebung, lauf.id, v, { ...d, pruefsumme: original.pruefsumme }, original.bytes);
    }
    if (!weiter) return "fertig";
  }
}

async function exportLauf(umgebung: Umgebung, lauf: typeof importe.$inferSelect, o: ImportOptionen): Promise<Ende> {
  if (!o.importOrdner) throw new Error("Kein Importordner eingerichtet (IMPORT_ORDNER)");
  const zip = await zipOeffnen(exportPfad(o.importOrdner, lauf.id));
  try {
    const namen = [...zip.eintraege.keys()].filter(istManifest);
    if (!namen.length) throw new Error("manifest.json fehlt; ist das ein Export von Paperless-ngx?");
    const teile: unknown[] = [];
    for (const name of namen) {
      try {
        teile.push(jsonLesen(new TextDecoder().decode(await zip.lesen(name, MAX_MANIFEST))));
      } catch (err) {
        throw new Error(`${name}: ${err instanceof SyntaxError ? "kein gültiges JSON" : meldung(err)}`);
      }
    }
    const exp = manifestLesen(teile);
    const v: Vorbereitet = await vorbereiten(umgebung.db, exp.felder);
    const hinweise = [
      ...v.hinweise,
      ...(exp.papierkorb
        ? [`${anzahl(exp.papierkorb, "Dokument", "Dokumente")} im Papierkorb von Paperless-ngx nicht übernommen`]
        : []),
    ];
    await setzen(umgebung, lauf.id, { gesamt: exp.dokumente.length, hinweise });
    const fertig = await erledigt(umgebung.db, lauf.id);
    for (const d of exp.dokumente) {
      if (fertig.has(d.id)) continue;
      if (await abbruchGewuenscht(umgebung, lauf.id)) return "abgebrochen";
      if (!d.datei) {
        await fehlerFesthalten(umgebung.db, lauf.id, d, "Original fehlt im Export (exportiert mit --data-only?)");
        continue;
      }
      const bytes = await zip.lesen(d.datei, MAX_UPLOAD).catch((err: Error) => err);
      if (bytes instanceof Error) await fehlerFesthalten(umgebung.db, lauf.id, d, bytes.message);
      else await dokumentUebernehmen(umgebung, lauf.id, v, d, bytes);
    }
    return "fertig";
  } finally {
    await zip.schliessen();
  }
}

/**
 * Führt den nächsten offenen Lauf aus, bis er fertig, abgebrochen oder gescheitert ist; null, wenn keiner wartet. Ein
 * hochgeladener Export wird danach aus dem Importordner entfernt.
 */
export async function naechsterImport(
  umgebung: Umgebung,
  o: ImportOptionen,
): Promise<{ id: string; status: "fertig" | "abgebrochen" | "fehler"; meldung?: string } | null> {
  const [offen] = await umgebung.db
    .select()
    .from(importe)
    .where(inArray(importe.status, ["wartet", "laeuft"]))
    .orderBy(asc(importe.erstelltAm), asc(importe.id))
    .limit(1);
  if (!offen) return null;
  if (offen.status === "wartet") {
    const [begonnen] = await mitAkteur(umgebung.db, AKTEUR, (tx) =>
      tx
        .update(importe)
        .set({ status: "laeuft", begonnenAm: sql`now()` })
        .where(and(eq(importe.id, offen.id), eq(importe.status, "wartet")))
        .returning(),
    );
    if (!begonnen) return null;
  }
  try {
    const ende = offen.art === "api" ? await apiLauf(umgebung, offen, o) : await exportLauf(umgebung, offen, o);
    await setzen(umgebung, offen.id, { status: ende, beendetAm: new Date() });
    if (offen.art === "export") await exportEntfernen(o.importOrdner, offen.id);
    return { id: offen.id, status: ende };
  } catch (err) {
    await setzen(umgebung, offen.id, { status: "fehler", meldung: meldung(err), beendetAm: new Date() });
    if (offen.art === "export") await exportEntfernen(o.importOrdner, offen.id);
    return { id: offen.id, status: "fehler", meldung: meldung(err) };
  }
}
