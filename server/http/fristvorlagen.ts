import { nameVergeben } from "../archivansichten/archivansichten.ts";
import { FristVorschauEingabe, fristVorschau } from "../einordnung/einordnung.ts";
import { VorlageEingabe, vorlageAnlegen, vorlageLoeschen, vorlagenListen } from "../fristvorlagen/fristvorlagen.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

const FELD_MELDUNG: Record<string, string> = {
  art: "Die Art fehlt oder ist unbekannt",
  entstanden: "Das Datum der Entstehung fehlt oder hat nicht das Format JJJJ-MM-TT",
  freiwilligBis: "Das Datum „bis wann“ hat nicht das Format JJJJ-MM-TT",
};

/**
 * Fristen beim Einordnen: die Vorschau (server/einordnung/) und eigene Fristvorlagen (server/fristvorlagen/); lesen
 * alle, die einordnen; Vorlagen anlegen und löschen der Inhaber
 */
export function fristvorlagenRouten(app: App, umgebung: AppUmgebung) {
  app.get("/api/fristen/vorschau", async (c) => {
    // Ein leeres Feld „bis wann“ zählt wie ein fehlendes
    const { freiwilligBis, ...rest } = c.req.query();
    const eingabe = FristVorschauEingabe.safeParse({ ...rest, ...(freiwilligBis ? { freiwilligBis } : {}) });
    if (!eingabe.success) {
      const feld = String(eingabe.error.issues[0]?.path[0] ?? "");
      return c.json({ fehler: FELD_MELDUNG[feld] ?? "Die Angaben für die Frist stimmen nicht" }, 400);
    }
    try {
      // Mitarbeiter und Tokens sehen nie Sperren (docs/zugaenge.md, tokenDarf): Für sie wird keine geprüft
      const nutzer = c.get("nutzer");
      const sperrenPruefen = nutzer.role !== "mitarbeiter" && !nutzer.token;
      return c.json(await fristVorschau(umgebung.db, eingabe.data, { sperrenPruefen }));
    } catch (err) {
      // Wie bei der Einordnung: Meldungen von fristende sind für Menschen, Datenbankfehler gehen nie nach außen
      if (err instanceof Error && !("code" in err) && !("cause" in err && err.cause))
        return c.json({ fehler: err.message }, 400);
      throw err;
    }
  });

  app.get("/api/fristvorlagen", async (c) => c.json(await vorlagenListen(umgebung.db)));

  app.post("/api/fristvorlagen", async (c) => {
    const eingabe = VorlageEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "name (1 bis 100 Zeichen) und monate (1 bis 1200) angeben" }, 400);
    try {
      return c.json(await vorlageAnlegen(umgebung.db, eingabe.data, akteur(c.get("nutzer"))), 201);
    } catch (err) {
      if (nameVergeben(err)) return c.json({ fehler: "Eine Vorlage mit diesem Namen gibt es schon" }, 409);
      throw err;
    }
  });

  app.delete("/api/fristvorlagen/:id", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const ok = id.success && (await vorlageLoeschen(umgebung.db, id.data, akteur(c.get("nutzer"))));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Keine Vorlage mit dieser ID" }, 404);
  });
}
