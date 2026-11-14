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
    });
  });

  it("liest Port und Datenbank", () => {
    const env = readEnv({ PORT: "8080", DATABASE_URL: "postgres://belegt@localhost:5432/belegt" });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_URL).toBe("postgres://belegt@localhost:5432/belegt");
  });

  it("nennt ungültige Werte beim Namen", () => {
    expect(() => readEnv({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => readEnv({ DATABASE_URL: "keine-adresse" })).toThrow(/DATABASE_URL/);
    expect(() => readEnv({ BETTER_AUTH_SECRET: "zu-kurz" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
