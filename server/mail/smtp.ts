import { SMTPServer, type SMTPServerOptions } from "smtp-server";
import type { Umgebung } from "../dokumente/dokumente.ts";
import { MAX_UPLOAD } from "../grundlagen.ts";
import { finden } from "../zugang/tokens.ts";
import { mailAufnehmen } from "./import.ts";

/**
 * SMTP-Journal: Ein Mailserver (etwa Stalwart) schickt jede Mail zusätzlich an Belegt, das sie unverändert archiviert.
 * Anmelden muss er sich mit AUTH und einem API-Token mit dem Recht schreiben als Passwort (Benutzername beliebig); so
 * gilt ein Widerruf auch hier, und im Audit-Log steht token:<Name>. Ohne TLS nur in einem geschützten Netz betreiben.
 */

export interface SmtpOptionen {
  /** Nur diese Empfänger nimmt Belegt an (klein geschrieben); leer: alle */
  empfaenger?: string[];
  tls?: { key: Buffer; cert: Buffer };
}

/** Fehler mit SMTP-Antwortcode; 4xx lässt den Absender es später noch einmal versuchen. Text nur in ASCII (RFC 5321, 2.4) */
const smtpFehler = (code: number, meldung: string) => Object.assign(new Error(meldung), { responseCode: code });

export function smtpServer(umgebung: Umgebung, { empfaenger = [], tls }: SmtpOptionen = {}) {
  const erlaubt = new Set(empfaenger.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const optionen: SMTPServerOptions = {
    name: "belegt",
    banner: "Belegt SMTP-Journal",
    size: MAX_UPLOAD,
    authMethods: ["PLAIN", "LOGIN"],
    authOptional: false,
    // Ohne TLS-Zertifikat geht AUTH im Klartext; das ist nur im eigenen Netz vertretbar (docs/eingang.md)
    allowInsecureAuth: !tls,
    secure: false,
    ...(tls ? { key: tls.key, cert: tls.cert } : { disabledCommands: ["STARTTLS"] }),
    logger: false,
    onAuth(auth, _sitzung, fertig) {
      finden(umgebung.db, auth.password ?? "").then(
        (token) =>
          token?.recht === "schreiben"
            ? fertig(null, { user: token.name })
            : fertig(smtpFehler(535, "Anmeldung abgelehnt: API-Token mit dem Recht schreiben noetig")),
        () => fertig(smtpFehler(454, "Anmeldung gerade nicht moeglich")),
      );
    },
    onRcptTo(adresse, _sitzung, fertig) {
      if (erlaubt.size && !erlaubt.has(adresse.address.toLowerCase()))
        return fertig(smtpFehler(550, "Empfaenger hier nicht bekannt"));
      fertig();
    },
    onData(strom, sitzung, fertig) {
      const teile: Buffer[] = [];
      strom.on("data", (t: Buffer) => teile.push(t));
      strom.on("error", (err) => fertig(err));
      strom.on("end", () => {
        if ((strom as { sizeExceeded?: boolean }).sizeExceeded) return fertig(smtpFehler(552, "Mail zu gross"));
        const roh = new Uint8Array(Buffer.concat(teile));
        mailAufnehmen(umgebung, roh, "mail", `token:${String(sitzung.user)}`).then(
          ({ id, neu }) => fertig(null, neu ? `Archiviert ${id}` : `Schon archiviert ${id}`),
          (err) => {
            // Nur ins Log, nicht an den Absender: die Meldung kann Teile der Mail enthalten
            console.error(
              `SMTP-Journal: Aufnahme fehlgeschlagen: ${err instanceof Error ? err.message.split("\n")[0] : err}`,
            );
            fertig(smtpFehler(451, "Aufnahme fehlgeschlagen, bitte spaeter erneut"));
          },
        );
      });
    },
  };
  return new SMTPServer(optionen);
}
