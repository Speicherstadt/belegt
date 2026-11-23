import aufnahmeAdresse from "../../demo/aufnahme.json?url";
import { adressenUmlenken } from "../lib/adresse.ts";
import { m } from "../paraglide/messages.js";
import { demoServer } from "./antworten.ts";
import type { Aufnahme } from "./aufnahme.ts";

/*
 * Macht die App zur Demo, bevor sie startet (src/main.tsx, nur im Modus demo): Anfragen an /api beantwortet der Server
 * der Demo in der Seite (./antworten.ts) aus der Aufnahme (demo/aufnahme.json), Bilder und Dateien kommen aus
 * demo/dateien/. Alles andere geht wie gewohnt ins Netz.
 */

/** Die aufgenommenen Dateien; Vite legt sie beim Bauen mit eigener Adresse ab */
const DATEIEN = import.meta.glob<string>("../../demo/dateien/*", { query: "?url", import: "default", eager: true });
const dateiAdresse = (name: string) => DATEIEN[`../../demo/dateien/${name}`] ?? name;

const netz = window.fetch.bind(window);
const aufnahme = (await (await netz(aufnahmeAdresse)).json()) as Aufnahme;
const server = demoServer(aufnahme, dateiAdresse, () => m.demo_not_possible());

const istApi = (url: URL) => url.origin === window.location.origin && url.pathname.startsWith("/api/");

window.fetch = Object.assign(async (eingabe: RequestInfo | URL, init?: RequestInit) => {
  const anfrage = new Request(eingabe, init);
  const url = new URL(anfrage.url);
  return istApi(url) ? server.beantworten(anfrage.method, url) : netz(eingabe, init);
}, window.fetch);

adressenUmlenken((pfad) => server.adresse(pfad));
