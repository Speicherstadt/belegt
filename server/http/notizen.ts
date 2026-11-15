import { laden } from "../dokumente/dokumente.ts";
import { regelVerletzt } from "../loeschung/loeschung.ts";
import { NotizEingabe, notizAnlegen, notizenZu, notizZurueckziehen } from "../notizen/notizen.ts";
import { type App, type AppUmgebung, akteur, Id } from "./gemeinsam.ts";

/*
 * Notizen zu einem Dokument (docs/dokument.md#notizen). Lesen und schreiben Inhaber und Steuerberatung, Tokens nach
 * ihrem Recht; Prüfer nicht (server/zugang/pruefer.ts lässt den Pfad nicht zu): Notizen sind keine Unterlage.
 */
export function notizenRouten(app: App, umgebung: AppUmgebung) {
  app.get("/api/dokumente/:id/notizen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    return c.json(await notizenZu(umgebung.db, dokument.id));
  });

  app.post("/api/dokumente/:id/notizen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const dokument = id.success ? await laden(umgebung.db, id.data) : null;
    if (!dokument) return c.json({ fehler: "Nicht gefunden" }, 404);
    const eingabe = NotizEingabe.safeParse(await c.req.json().catch(() => null));
    if (!eingabe.success) return c.json({ fehler: "text: 1 bis 5000 Zeichen" }, 400);
    try {
      return c.json(await notizAnlegen(umgebung.db, dokument.id, eingabe.data.text, akteur(c.get("nutzer"))), 201);
    } catch (err) {
      const meldung = regelVerletzt(err);
      if (meldung) return c.json({ fehler: meldung }, 409);
      throw err;
    }
  });

  /** Zurückziehen darf, wer die Notiz schrieb, und der Inhaber jede */
  app.post("/api/dokumente/:id/notizen/:notiz/zurueckziehen", async (c) => {
    const id = Id.safeParse(c.req.param("id"));
    const notiz = Id.safeParse(c.req.param("notiz"));
    const nutzer = c.get("nutzer");
    const ok =
      id.success &&
      notiz.success &&
      (await notizZurueckziehen(umgebung.db, {
        dokumentId: id.data,
        notizId: notiz.data,
        akteur: akteur(nutzer),
        alle: nutzer.role === "inhaber" && !nutzer.token,
      }));
    return ok ? c.json({ ok: true }) : c.json({ fehler: "Keine eigene Notiz mit dieser ID" }, 404);
  });
}
