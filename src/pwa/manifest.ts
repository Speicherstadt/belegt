/*
 * Installierbare Web-App: Manifest, Seite ohne Verbindung und die Namen, die Service Worker (sw.js) und Oberfläche
 * teilen. Die Texte kommen aus messages/*.json, wie alle Texte der Oberfläche.
 */

/** Feld im Formular, mit dem das Betriebssystem geteilte Dateien schickt (share_target) */
export const TEILEN_FELD = "dateien";
/** Adresse, an die geteilt wird; der Service Worker nimmt den POST an, die Seite der App zeigt die Dateien */
export const TEILEN_PFAD = "/teilen";
/** Cache, in dem geteilte Dateien liegen, bis sie hochgeladen oder verworfen sind */
export const TEILEN_CACHE = "belegt-teilen";
/** Präfix des Caches mit der Seite ohne Verbindung; dahinter die Version des Workers */
export const OFFLINE_CACHE = "belegt-offline-";
export const OFFLINE_PFAD = "/offline.html";

/** Was sich teilen lässt: PDF, Bilder, Office, OpenDocument, Text und Mails */
export const TEILEN_TYPEN = [
  "application/pdf",
  "image/*",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.*",
  "application/vnd.oasis.opendocument.*",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/rtf",
  "text/plain",
  "text/csv",
  "message/rfc822",
  "application/xml",
  "text/xml",
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".webp",
  ".tif",
  ".tiff",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
  ".txt",
  ".csv",
  ".eml",
  ".xml",
];

/** Farben aus src/styles.css: Hintergrund hell und dunkel */
export const FARBE_HELL = "#ffffff";
export const FARBE_DUNKEL = "#09090b";

export interface Texte {
  app_name: string;
  app_claim: string;
}

export function manifest(texte: Texte) {
  return {
    id: "/",
    name: texte.app_name,
    short_name: texte.app_name,
    description: texte.app_claim,
    lang: "de",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: FARBE_HELL,
    theme_color: FARBE_HELL,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Nur Chromium (Android, Desktop) kennt das Teilen an eine installierte Web-App
    share_target: {
      action: TEILEN_PFAD,
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: TEILEN_FELD, accept: TEILEN_TYPEN }] },
    },
  };
}
