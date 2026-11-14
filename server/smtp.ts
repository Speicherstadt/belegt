import { readFileSync } from "node:fs";
import { dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import { verbinden } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { smtpServer } from "./mail/smtp.ts";

/*
 * SMTP-Journal als eigener Prozess: nimmt Mails per SMTP an und archiviert sie (server/mail/smtp.ts). Migrationen
 * wendet der Server an.
 */
const env = readEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL fehlt");
const { db } = verbinden(env.DATABASE_URL);
const speicher = dateispeicher({ verzeichnis: () => env.DOCUMENTS_DIR });
const tls =
  env.SMTP_TLS_KEY && env.SMTP_TLS_CERT
    ? { key: readFileSync(env.SMTP_TLS_KEY), cert: readFileSync(env.SMTP_TLS_CERT) }
    : undefined;
const server = smtpServer({ db, speicher }, { empfaenger: env.SMTP_EMPFAENGER?.split(",") ?? [], tls });
server.on("error", (err) => console.error(`SMTP-Journal: ${err.message}`));
server.listen(env.SMTP_PORT, () =>
  console.log(`SMTP-Journal auf Port ${env.SMTP_PORT}${tls ? " mit STARTTLS" : " ohne TLS"}`),
);
