import { defineConfig, devices } from "@playwright/test";

/** Eigene Ports für die Tests, damit eine laufende Entwicklungsumgebung unberührt bleibt */
const APP_PORT = 5185;
const SERVER_PORT = 3185;

/** Sitzung des Inhabers aus e2e/einrichten.setup.ts */
export const INHABER = "e2e/.auth/inhaber.json";

const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: "./e2e",
  // Alle Tests teilen sich einen Server mit einer Datenbank: nacheinander, in der Reihenfolge der Dateien
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "off",
    launchOptions,
  },
  projects: [
    // Richtet Belegt über die Oberfläche ein und merkt sich die Sitzung des Inhabers für alle weiteren Tests
    { name: "einrichten", testMatch: /einrichten\.setup\.ts/, use: { ...devices["Desktop Chrome"], launchOptions } },
    {
      name: "desktop",
      dependencies: ["einrichten"],
      use: { ...devices["Desktop Chrome"], launchOptions, storageState: INHABER },
    },
    {
      name: "handy",
      dependencies: ["einrichten"],
      use: { ...devices["Pixel 7"], launchOptions, storageState: INHABER },
    },
    // Bilder für README und Doku (e2e/screenshots.ts), nur mit DOKU_SCREENSHOTS=1: bun run screenshots
    ...(process.env.DOKU_SCREENSHOTS
      ? [
          {
            name: "screenshots",
            testMatch: /screenshots\.ts/,
            dependencies: ["einrichten"],
            use: {
              ...devices["Desktop Chrome"],
              launchOptions,
              storageState: INHABER,
              viewport: { width: 1280, height: 800 },
              deviceScaleFactor: 2,
              locale: "de-DE",
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: "bun e2e/server.ts",
      url: `http://localhost:${SERVER_PORT}/healthz`,
      env: { E2E_SERVER_PORT: String(SERVER_PORT), E2E_APP_URL: `http://localhost:${APP_PORT}` },
      reuseExistingServer: false,
    },
    {
      command: `bunx vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      env: { BELEGT_SERVER: `http://127.0.0.1:${SERVER_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
