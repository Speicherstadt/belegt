import { createTransport } from "nodemailer";

/*
 * Versand per SMTP mit nodemailer (MIT). MAIL_SMTP_URL nennt Server, Port und Benutzer (smtp://… mit STARTTLS, smtps://…
 * mit TLS); das Passwort kommt aus MAIL_SMTP_PASSWORT oder steht in der Adresse. Beides kommt nur aus der Umgebung und
 * erscheint nie in Log, Datenbank oder Oberfläche; Fehler geben nur die Meldung weiter, nie das Objekt.
 */

export interface Mail {
  an: string[];
  betreff: string;
  text: string;
}

/** Schickt eine Mail; wirft bei einem Fehler */
export type Versender = (mail: Mail) => Promise<void>;

export interface MailKonfig {
  url: string;
  passwort?: string;
  absender: string;
}

export function smtpVersender({ url, passwort, absender }: MailKonfig): Versender {
  const adresse = new URL(url);
  const transport = createTransport({
    host: adresse.hostname,
    port: Number(adresse.port) || (adresse.protocol === "smtps:" ? 465 : 587),
    secure: adresse.protocol === "smtps:",
    // Ohne TLS nur, wenn die Adresse es ausdrücklich sagt (?tls=nein), etwa für einen Server im eigenen Netz
    ignoreTLS: adresse.searchParams.get("tls") === "nein",
    requireTLS: adresse.protocol === "smtp:" && adresse.searchParams.get("tls") !== "nein",
    auth: adresse.username
      ? { user: decodeURIComponent(adresse.username), pass: passwort ?? decodeURIComponent(adresse.password) }
      : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  return async ({ an, betreff, text }) => {
    try {
      await transport.sendMail({ from: absender, to: an, subject: betreff, text });
    } catch (err) {
      throw new Error((err instanceof Error ? err.message : String(err)).slice(0, 300));
    }
  };
}

/** Aus MAIL_SMTP_URL, MAIL_SMTP_PASSWORT und MAIL_ABSENDER; ohne MAIL_SMTP_URL keine Mails */
export function mailAusEnv(env: {
  MAIL_SMTP_URL?: string;
  MAIL_SMTP_PASSWORT?: string;
  MAIL_ABSENDER?: string;
  BETTER_AUTH_URL: string;
}): { versender: Versender; absender: string } | undefined {
  if (!env.MAIL_SMTP_URL) return undefined;
  const absender = env.MAIL_ABSENDER ?? `belegt@${new URL(env.BETTER_AUTH_URL).hostname}`;
  return {
    absender,
    versender: smtpVersender({ url: env.MAIL_SMTP_URL, passwort: env.MAIL_SMTP_PASSWORT, absender }),
  };
}
