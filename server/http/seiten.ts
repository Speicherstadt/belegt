import { z } from "zod";
import { laden } from "../dokumente/dokumente.ts";
import { fuerDokument } from "../loeschung/loeschung.ts";
import { ableiten, ableitungenZu, istAbleitungsFehler } from "../seiten/ableiten.ts";
import { SeitenOperation } from "../seiten/seiten.ts";
import { rasterVerfuegbar, seiteAlsJpeg, seitenzahl } from "../vorschaubild/raster.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

/*
 * Seiten eines PDFs als Bilder und neue Dokumente daraus (docs/dokument.md#seiten-bearbeiten). Bearbeiten darf nur, wer
 * schreibt, und nur mit Sitzung: Kein Token erreicht diese Aufrufe (server/zugang/tokens.ts).
 */

const Zusammenfuegen = z.object({ ids: z.array(Id).min(2).max(20) });
const SeitenNummer = z.coerce.number().int().min(1).max(5000);

export function seitenRouten(app: App, umgebung: AppUmgebung) {
  /** Ein PDF, das es gibt und nicht gelöscht ist, mit seiner Datei; sonst die Antwort */
  async function pdfLaden(roh: string) {
    const id = Id.safeParse(roh);
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return { fehler: { status: 404, meldung: "Nicht gefunden" } } as const;
    if (dokument.mimeType !== "application/pdf") return { fehler: { status: 404, meldung: "Kein PDF" } } as const;
    if ((await fuerDokument(umgebung.db, dokument.id))?.bestaetigtAm)
      return { fehler: { status: 410, meldung: "Das Dokument ist gelöscht" } } as const;
    if (!rasterVerfuegbar()) return { fehler: { status: 503, meldung: "pdftoppm fehlt" } } as const;
    const bytes = await umgebung.speicher.laden(dokument.sha256).catch(() => null);
    if (!bytes) return { fehler: { status: 409, meldung: "Die Datei fehlt oder wurde verändert" } } as const;
    return { pdf: new Uint8Array(bytes) } as const;
  }

  app.get("/api/dokumente/:id/seiten", async (c) => {
    const r = await pdfLaden(c.req.param("id"));
    if (r.fehler) return c.json({ fehler: r.fehler.meldung }, r.fehler.status);
    const anzahl = await seitenzahl(r.pdf).catch(() => null);
    return anzahl ? c.json({ anzahl }) : c.json({ fehler: "Das PDF lässt sich nicht lesen" }, 422);
  });

  /** Eine Seite als JPEG, 200 px breit, mit ihrer Drehung im PDF */
  app.get("/api/dokumente/:id/seiten/:nr", async (c) => {
    const nr = SeitenNummer.safeParse(c.req.param("nr"));
    if (!nr.success) return c.json({ fehler: "Ungültige Seite" }, 400);
    const r = await pdfLaden(c.req.param("id"));
    if (r.fehler) return c.json({ fehler: r.fehler.meldung }, r.fehler.status);
    const bild = await seiteAlsJpeg(r.pdf, { seite: nr.data, breite: 200 }).catch(() => null);
    if (!bild) return c.json({ fehler: "Diese Seite gibt es nicht oder sie lässt sich nicht lesen" }, 404);
    return c.body(new Uint8Array(bild), 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.post("/api/dokumente/:id/seiten", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ fehler: "Nicht gefunden" }, 404);
    const auftrag = SeitenOperation.safeParse(await c.req.json().catch(() => null));
    if (!auftrag.success) return c.json({ fehler: "Ungültige Operation", details: auftrag.error.issues }, 400);
    try {
      const dokumente = await ableiten(umgebung, {
        quellen: [id.data],
        auftrag: auftrag.data,
        akteur: akteur(c.get("nutzer")),
      });
      return c.json({ dokumente }, 201);
    } catch (err) {
      if (istAbleitungsFehler(err)) return c.json({ fehler: err.message }, err.status);
      throw err;
    }
  });

  app.post("/api/dokumente/zusammenfuegen", async (c) => {
    const eingabe = Zusammenfuegen.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success || new Set(eingabe.data.ids).size !== eingabe.data.ids.length)
      return c.json({ fehler: "ids: 2 bis 20 verschiedene PDFs" }, 400);
    try {
      const [dokument] = await ableiten(umgebung, {
        quellen: eingabe.data.ids,
        auftrag: { operation: "zusammenfuegen" },
        akteur: akteur(c.get("nutzer")),
      });
      return c.json(dokument, 201);
    } catch (err) {
      if (istAbleitungsFehler(err)) return c.json({ fehler: err.message }, err.status);
      throw err;
    }
  });

  app.get("/api/dokumente/:id/ableitungen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json(await ableitungenZu(umgebung.db, dokument.id, c.get("nutzer").zeitraum));
  });
}
