import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { RECHTE, ROLLEN, type Sichtbereich } from "../../shared/rollen.ts";

/* Tabellen für Better Auth (Kern), wie in Haben, mit der Rolle am Zugang */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Vorgabe ist die mit den wenigsten Rechten; Inhaber wird nur das erste Konto (Hook in server/auth.ts) */
    role: text("role", { enum: ROLLEN }).notNull().default("pruefer"),
    /** Nur für Prüfer: der freigegebene Zeitraum (Z1); außerhalb sieht der Zugang nichts */
    zeitraumVon: date("zeitraum_von"),
    zeitraumBis: date("zeitraum_bis"),
    /** Nur für Mitarbeiter: lesen oder bearbeiten, und welche Dokumente (server/zugang/sicht.ts) */
    recht: text("recht", { enum: RECHTE }),
    sichtbereich: jsonb("sichtbereich").$type<Sichtbereich>(),
    /** Der Inhaber hat den Zugang entzogen; danach meldet er sich nicht mehr an */
    entzogenAm: timestamp("entzogen_am", { withTimezone: true }),
    /** TOTP ist eingerichtet und bestätigt (Plugin twoFactor von Better Auth) */
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  },
  // Genau ein Inhaber, auch bei zwei gleichzeitigen Einrichtungen
  (t) => [
    uniqueIndex("user_inhaber_single").on(t.role).where(sql`${t.role} = 'inhaber'`),
    check("user_role", sql`${t.role} in ('inhaber', 'steuerberatung', 'pruefer', 'mitarbeiter')`),
    check(
      "user_zeitraum",
      sql`case when ${t.role} = 'pruefer' then ${t.zeitraumVon} is not null and ${t.zeitraumBis} is not null and ${t.zeitraumVon} <= ${t.zeitraumBis} else ${t.zeitraumVon} is null and ${t.zeitraumBis} is null end`,
    ),
    // Ein Mitarbeiter hat immer Recht und Sichtbereich, alle anderen nie; coalesce, weil CHECK ein NULL durchließe
    check(
      "user_mitarbeiter",
      sql`case when ${t.role} = 'mitarbeiter' then coalesce(${t.recht} in ('lesen', 'bearbeiten') and jsonb_typeof(${t.sichtbereich}) = 'object', false) else ${t.recht} is null and ${t.sichtbereich} is null end`,
    ),
    // Den Inhaber entzieht niemand
    check("user_entzogen", sql`${t.entzogenAm} is null or ${t.role} <> 'inhaber'`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Wie die Sitzung entstand: passwort, zwei_faktor, passkey oder oidc (server/zugang/zwei-faktor.ts) */
    anmeldeweg: text("anmeldeweg"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Einladung für einen weiteren Zugang (Steuerberatung, Prüfer). Der Link enthält ein zufälliges Token, gespeichert ist
 * nur sein SHA-256; einmal einlösbar, nur bis gueltig_bis, zurückziehbar.
 */
export const einladungen = pgTable(
  "einladungen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    rolle: text("rolle", { enum: ROLLEN }).notNull(),
    zeitraumVon: date("zeitraum_von"),
    zeitraumBis: date("zeitraum_bis"),
    recht: text("recht", { enum: RECHTE }),
    sichtbereich: jsonb("sichtbereich").$type<Sichtbereich>(),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
    eingeloestAm: timestamp("eingeloest_am", { withTimezone: true }),
    eingeloestVon: text("eingeloest_von"),
    zurueckgezogenAm: timestamp("zurueckgezogen_am", { withTimezone: true }),
  },
  // Einladen lässt sich nur in Rollen ohne volles Schreibrecht; Inhaber gibt es genau einen
  (t) => [
    check("einladungen_rolle", sql`${t.rolle} in ('steuerberatung', 'pruefer', 'mitarbeiter')`),
    // Ein Prüfer bekommt immer einen Zeitraum, die Steuerberatung nie
    check(
      "einladungen_zeitraum",
      sql`case when ${t.rolle} = 'pruefer' then ${t.zeitraumVon} is not null and ${t.zeitraumBis} is not null and ${t.zeitraumVon} <= ${t.zeitraumBis} else ${t.zeitraumVon} is null and ${t.zeitraumBis} is null end`,
    ),
    check(
      "einladungen_mitarbeiter",
      sql`case when ${t.rolle} = 'mitarbeiter' then coalesce(${t.recht} in ('lesen', 'bearbeiten') and jsonb_typeof(${t.sichtbereich}) = 'object', false) else ${t.recht} is null and ${t.sichtbereich} is null end`,
    ),
  ],
);

/**
 * Link, mit dem ein Zugang sein Passwort neu setzt (Inhaber oder Notfall-Skript stellen ihn aus). Gespeichert ist nur
 * der SHA-256 des Tokens; einmal einlösbar, nur bis gueltig_bis, ein neuer Link macht offene andere ungültig.
 */
export const passwortLinks = pgTable(
  "passwort_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
    eingeloestAm: timestamp("eingeloest_am", { withTimezone: true }),
  },
  (t) => [index("passwort_links_user_id_idx").on(t.userId)],
);

/**
 * TOTP und Backup-Codes eines Zugangs (Plugin twoFactor von Better Auth, Modell twoFactor). Geheimnis und Backup-Codes
 * verschlüsselt Better Auth mit BETTER_AUTH_SECRET; beide stehen nicht im Audit-Log.
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Erst nach dem ersten richtigen Code bestätigt; vorher gilt TOTP nicht */
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [uniqueIndex("two_factor_user_id_unique").on(t.userId)],
);

/** Passkeys (WebAuthn) eines Zugangs (Plugin passkey von Better Auth); gespeichert ist nur der öffentliche Schlüssel */
export const passkey = pgTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_id_idx").on(t.userId), uniqueIndex("passkey_credential_id_unique").on(t.credentialID)],
);

/**
 * Einstellungen der Anmeldung, genau eine Zeile, protokolliert: für welche Rollen ein zweiter Faktor Pflicht ist
 * (docs/zugaenge.md#zwei-faktor)
 */
export const anmeldungEinstellungen = pgTable(
  "anmeldung_einstellungen",
  {
    id: smallint("id").primaryKey().default(1),
    zweiFaktorPflicht: text("zwei_faktor_pflicht").array().notNull().default(sql`'{}'::text[]`),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("anmeldung_einstellungen_eine_zeile", sql`${t.id} = 1`),
    check(
      "anmeldung_einstellungen_rollen",
      sql`${t.zweiFaktorPflicht} <@ array['inhaber', 'steuerberatung', 'pruefer', 'mitarbeiter']::text[]`,
    ),
  ],
);
