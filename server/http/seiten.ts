import { z } from "zod";
import { aehnliche } from "../aehnliche/aehnliche.ts";
import { laden } from "../dokumente/dokumente.ts";
import { fuerDokument } from "../loeschung/loeschung.ts";
import { ableiten, ableitungenZu, istAbleitungsFehler } from "../seiten/ableiten.ts";
import { SeitenOperation } from "../seiten/seiten.ts";
import { begrenzt } from "../trennen/trennen.ts";
import { rasterVerfuegbar, seiteAlsJpeg, seitenzahl } from "../vorschaubild/raster.ts";
import { sichtVon } from "../zugang/sicht.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

/*
 * Seiten eines PDFs als Bilder und neue Dokumente daraus (docs/dokument.md#seiten-bearbeiten), dazu Ableitungen und
 * ähnliche Dokumente. Bearbeiten darf nur, wer schreibt, und nur mit Sitzung: Kein Token erreicht diese Aufrufe
 * (server/zugang/tokens.ts).
 */

const Zusammenfuegen = z.object({ ids: z.array(Id).min(2).max(20) });
const SeitenNummer = z.coerce.number().int().min(1).max(5000);

export function seitenRouten(app: App, umgebung: AppUmgebung) {
  // Jedes Seitenbild lädt das ganze PDF und startet pdftoppm: höchstens vier zugleich, 32 warten, darüber 503. Die
  // Oberfläche lädt die Bilder erst, wenn sie sichtbar werden
  const seitenTor = begrenzt(4, 32);
  const ausgelastet = { fehler: { status: 503, meldung: "Gerade zu viele Seitenbilder, gleich noch einmal" } } as const;

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

  /** Status und Kopf einer Ablehnung; 503 mit Retry-After */
  const abgelehnt = (status: number) => (status === 503 ? { "Retry-After": "5" } : undefined);

  app.get("/api/dokumente/:id/seiten", async (c) => {
    const r =
      (await seitenTor(async () => {
        const p = await pdfLaden(c.req.param("id"));
        return p.fehler ? p : { anzahl: await seitenzahl(p.pdf).catch(() => null) };
      })) ?? ausgelastet;
    if ("fehler" in r) return c.json({ fehler: r.fehler.meldung }, r.fehler.status, abgelehnt(r.fehler.status));
    return r.anzahl ? c.json({ anzahl: r.anzahl }) : c.json({ fehler: "Das PDF lässt sich nicht lesen" }, 422);
  });

  /** Eine Seite als JPEG, 200 px breit, mit ihrer Drehung im PDF */
  app.get("/api/dokumente/:id/seiten/:nr", async (c) => {
    const nr = SeitenNummer.safeParse(c.req.param("nr"));
    if (!nr.success) return c.json({ fehler: "Ungültige Seite" }, 400);
    const r =
      (await seitenTor(async () => {
        const p = await pdfLaden(c.req.param("id"));
        return p.fehler ? p : { bild: await seiteAlsJpeg(p.pdf, { seite: nr.data, breite: 200 }).catch(() => null) };
      })) ?? ausgelastet;
    if ("fehler" in r) return c.json({ fehler: r.fehler.meldung }, r.fehler.status, abgelehnt(r.fehler.status));
    const bild = r.bild;
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

  /** Bis zu fünf ähnliche Dokumente aus dem Volltext (server/aehnliche/) */
  app.get("/api/dokumente/:id/aehnliche", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json(await aehnliche(umgebung.db, dokument.id, { sicht: sichtVon(c.get("nutzer")) }));
  });

  app.get("/api/dokumente/:id/ableitungen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json(await ableitungenZu(umgebung.db, dokument.id, sichtVon(c.get("nutzer"))));
  });
}
