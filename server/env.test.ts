import { describe, expect, it } from "vitest";
import { readEnv } from "./env.ts";

describe("readEnv", () => {
  it("nimmt Vorgaben, wenn nichts gesetzt ist", () => {
    expect(readEnv({})).toEqual({
      PORT: 3000,
      DOCUMENTS_DIR: "data/dokumente",
      BETTER_AUTH_URL: "http://localhost:3000",
      ABRUF_MINUTEN: 5,
      SMTP_PORT: 2525,
      OIDC_NAME: "Firmenkonto",
      S3_REGION: "us-east-1",
      S3_PFAD_STIL: true,
      S3_SPERRE_TAGE: 0,
      TRENNBLATT_CODE: "BELEGT-TRENNER",
      EINGANG_ORDNER_TAGS: false,
    });
  });

  it("liest den Eingangsordner", () => {
    expect(readEnv({ EINGANG_ORDNER: "/var/lib/belegt/eingang" }).EINGANG_ORDNER).toBe("/var/lib/belegt/eingang");
    expect(readEnv({ EINGANG_ORDNER: "" }).EINGANG_ORDNER).toBeUndefined();
    expect(readEnv({}).EINGANG_ORDNER_TAGS).toBe(false);
    expect(readEnv({ EINGANG_ORDNER_TAGS: "true" }).EINGANG_ORDNER_TAGS).toBe(true);
    expect(() => readEnv({ EINGANG_ORDNER_TAGS: "ja" })).toThrow(/EINGANG_ORDNER_TAGS/);
  });

  it("liest Port und Datenbank", () => {
    const env = readEnv({ PORT: "8080", DATABASE_URL: "postgres://belegt@localhost:5432/belegt" });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_URL).toBe("postgres://belegt@localhost:5432/belegt");
  });

  it("nimmt leere Werte als nicht gesetzt, wie Compose sie für fehlende Variablen übergibt", () => {
    const env = readEnv({ MICROSOFT_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", SMTP_EMPFAENGER: "", PORT: "" });
    expect(env.MICROSOFT_CLIENT_ID).toBeUndefined();
    expect(env.SMTP_EMPFAENGER).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it("nennt ungültige Werte beim Namen", () => {
    expect(() => readEnv({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => readEnv({ DATABASE_URL: "keine-adresse" })).toThrow(/DATABASE_URL/);
    expect(() => readEnv({ BETTER_AUTH_SECRET: "zu-kurz" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
