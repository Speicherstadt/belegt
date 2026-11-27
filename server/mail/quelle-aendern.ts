import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { verschluesseln } from "../crypto.ts";
import { mitAkteur } from "../db/akteur.ts";
import type { Datenbank } from "../db/client.ts";
import { postfachAktionen, postfachMails, quellen } from "../db/schema.ts";
import { ohneGeheimnis, QuelleEingabe, type QuelleOhneGeheimnis } from "./abruf.ts";

/** Ändern: alles optional, art und Zustand nicht; das Passwort nur, wenn es neu gesetzt wird */
export const QuelleAenderung = z
  .object({
    name: QuelleEingabe.shape.name,
    host: QuelleEingabe.shape.host,
    port: QuelleEingabe.shape.port.removeDefault(),
    tls: QuelleEingabe.shape.tls.removeDefault(),
    benutzer: QuelleEingabe.shape.benutzer,
    passwort: QuelleEingabe.shape.passwort,
    ordner: QuelleEingabe.shape.ordner.removeDefault(),
  })
  .partial()
  .strict()
  .refine((e) => Object.keys(e).length > 0, { message: "Nichts zu ändern" });

/**
 * Ändert ein Postfach. Das Chiffrat bleibt, außer es kommt ein Passwort. Ändert sich, woher abgeholt wird, beginnt der
 * Abruf von vorn (der Import erkennt Doppelte). null: gibt es nicht; fehler: bei OAuth nicht änderbar.
 */
export async function aendern(
  db: Datenbank,
  schluessel: Buffer,
  id: string,
  eingabe: z.infer<typeof QuelleAenderung>,
  akteur: string,
): Promise<QuelleOhneGeheimnis | { fehler: string } | null> {
  const { passwort, ...felder } = eingabe;
  return mitAkteur(db, akteur, async (tx) => {
    const [alt] = await tx.select().from(quellen).where(eq(quellen.id, id)).for("update");
    if (!alt) return null;
    const andererServer = (["host", "port", "benutzer"] as const).some(
      (k) => felder[k] !== undefined && felder[k] !== alt[k],
    );
    // Beim Refresh-Token hängt die Anmeldung am Konto; Anbieter, Benutzer und Passwort bleiben, wie sie sind
    if (alt.oauth && (passwort !== undefined || andererServer || (felder.tls ?? alt.tls) !== alt.tls))
      return {
        fehler:
          "Passwort, Server, Port, Verschlüsselung und Benutzer eines Postfachs mit Microsoft- oder Google-Anmeldung lassen sich nicht ändern",
      };
    // Sonst ginge das gespeicherte Passwort an einen anderen Server oder Benutzer, oder unverschlüsselt ins Netz
    if ((andererServer || (alt.tls && felder.tls === false)) && passwort === undefined)
      return {
        fehler:
          "Server, Port, Benutzer oder das Abschalten von TLS lassen sich nur mit neuem Passwort ändern: Das Passwort muss neu eingegeben werden, damit es nicht an einen anderen Server oder unverschlüsselt geht",
      };
    const andereAdresse = (["host", "port", "benutzer", "ordner"] as const).some(
      (k) => felder[k] !== undefined && felder[k] !== alt[k],
    );
    const [neu] = await tx
      .update(quellen)
      .set({
        ...felder,
        ...(passwort === undefined ? {} : { ciphertext: verschluesseln(schluessel, Buffer.from(passwort)) }),
        ...(andereAdresse ? { letzteUid: 0, uidValidity: null, jmapStand: null, letzterFehler: null } : {}),
      })
      .where(eq(quellen.id, id))
      .returning();
    // Vorgemerkte Aktionen gelten dem alten Postfach (UID, Benutzer); im neuen träfen sie fremde Mails
    if (andererServer) {
      const offen = await tx
        .select()
        .from(postfachMails)
        .where(and(eq(postfachMails.quelleId, id), eq(postfachMails.status, "offen")));
      if (offen.length) {
        await tx.insert(postfachAktionen).values(
          offen.map((e) => ({
            postfachMailId: e.id,
            quelleId: id,
            dokumentId: e.dokumentId,
            aktion: alt.aktion,
            ziel: alt.aktion === "verschieben" ? (alt.aktionZielPfad ?? alt.aktionZiel) : null,
            ordner: e.ordner,
            uidValidity: e.uidValidity,
            uid: e.uid,
            jmapId: e.jmapId,
            ergebnis: "entfallen" as const,
            meldung: "Das Postfach wurde auf einen anderen Server, Port oder Benutzer umgestellt",
          })),
        );
        await tx
          .update(postfachMails)
          .set({ status: "entfallen" })
          .where(and(eq(postfachMails.quelleId, id), eq(postfachMails.status, "offen")));
      }
    }
    return ohneGeheimnis(neu!);
  });
}
