import { sql } from "drizzle-orm";
import { boolean, check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ROLLEN } from "../../shared/rollen.ts";

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
  },
  // Genau ein Inhaber, auch bei zwei gleichzeitigen Einrichtungen
  (t) => [
    uniqueIndex("user_inhaber_single").on(t.role).where(sql`${t.role} = 'inhaber'`),
    check("user_role", sql`${t.role} in ('inhaber', 'steuerberatung', 'pruefer')`),
    check(
      "user_zeitraum",
      sql`case when ${t.role} = 'pruefer' then ${t.zeitraumVon} is not null and ${t.zeitraumBis} is not null and ${t.zeitraumVon} <= ${t.zeitraumBis} else ${t.zeitraumVon} is null and ${t.zeitraumBis} is null end`,
    ),
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
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    gueltigBis: timestamp("gueltig_bis", { withTimezone: true }).notNull(),
    eingeloestAm: timestamp("eingeloest_am", { withTimezone: true }),
    eingeloestVon: text("eingeloest_von"),
    zurueckgezogenAm: timestamp("zurueckgezogen_am", { withTimezone: true }),
  },
  // Einladen lässt sich nur in Rollen ohne Schreibrecht; Inhaber gibt es genau einen
  (t) => [
    check("einladungen_rolle", sql`${t.rolle} in ('steuerberatung', 'pruefer')`),
    // Ein Prüfer bekommt immer einen Zeitraum, die Steuerberatung nie
    check(
      "einladungen_zeitraum",
      sql`case when ${t.rolle} = 'pruefer' then ${t.zeitraumVon} is not null and ${t.zeitraumBis} is not null and ${t.zeitraumVon} <= ${t.zeitraumBis} else ${t.zeitraumVon} is null and ${t.zeitraumBis} is null end`,
    ),
  ],
);
