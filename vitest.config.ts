import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    // Vorlage der Testdatenbanken einmal je Lauf migrieren (server/test-db.ts)
    globalSetup: ["server/test-db.ts"],
  },
});
