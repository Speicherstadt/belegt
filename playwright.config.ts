import { defineConfig, devices } from "@playwright/test";

/** Eigener Port für die Tests, damit eine laufende Entwicklungsumgebung unberührt bleibt */
const APP_PORT = 5185;

const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: "./e2e",
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
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "handy", use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: {
    command: `bunx vite --port ${APP_PORT} --strictPort`,
    url: `http://localhost:${APP_PORT}`,
    reuseExistingServer: false,
  },
});
