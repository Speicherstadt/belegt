import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "src/**/*.test.{ts,tsx}", "deploy/**/*.test.ts"],
    // Vorlage der Testdatenbanken einmal je Lauf migrieren (server/test-db.ts)
    globalSetup: ["server/test-db.ts"],
  },
});
