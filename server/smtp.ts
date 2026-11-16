import { readFileSync } from "node:fs";
import { verbinden } from "./db/client.ts";
import { zugriffLesen, zugriffWarnung } from "./db/rollen.ts";
import { readEnv } from "./env.ts";
import { smtpServer } from "./mail/smtp.ts";
import { speicherAusEnv } from "./speicher/auswahl.ts";

/*
 * SMTP-Journal als eigener Prozess: nimmt Mails per SMTP an und archiviert sie (server/mail/smtp.ts). Migrationen
 * wendet der Server an.
 */
const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
const { db, sql } = verbinden(env.DATABASE_URL);
// Mehr Rechte als nötig: Warnung im Log, Betrieb wie bisher (docs/betrieb.md, „Getrennte Datenbankrollen“)
const warnung = zugriffWarnung(await zugriffLesen(sql));
if (warnung) console.warn(`SMTP-Journal: ${warnung}`);
const { speicher } = speicherAusEnv(env);
const tls =
  env.SMTP_TLS_KEY && env.SMTP_TLS_CERT
    ? { key: readFileSync(env.SMTP_TLS_KEY), cert: readFileSync(env.SMTP_TLS_CERT) }
    : undefined;
const server = smtpServer({ db, speicher }, { empfaenger: env.SMTP_EMPFAENGER?.split(",") ?? [], tls });
server.on("error", (err) => console.error(`SMTP-Journal: ${err.message}`));
server.listen(env.SMTP_PORT, () =>
  console.log(`SMTP-Journal auf Port ${env.SMTP_PORT}${tls ? " mit STARTTLS" : " ohne TLS"}`),
);
