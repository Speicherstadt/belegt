/**
 * Das eigene Konto (Seite „Konto“): Stand des zweiten Faktors und QR-Code für TOTP. Jede Rolle ruft das auf, auch wer
 * sonst nur liest, und auch, solange die Pflicht zum zweiten Faktor die übrigen Aufrufe sperrt (server/http/zugang.ts)
 */
export const EIGENES_KONTO = /^\/api\/(ich|konto(\/qr)?)$/;
