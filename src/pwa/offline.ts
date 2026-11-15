import { FARBE_DUNKEL, FARBE_HELL } from "./manifest.ts";

/** Texte der Seite ohne Verbindung in einer Sprache */
export interface OfflineTexte {
  app_name: string;
  offline_title: string;
  offline_text: string;
  offline_retry: string;
}

const html = (s: string) =>
  s.replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z]!);

/**
 * Die eine Seite, die der Service Worker vorhält: ohne Verbindung statt der Fehlerseite des Browsers. Sie ist ohne
 * Daten aus dem Archiv und lädt nichts nach; die Sprache wählt sie wie die App (Browser, sonst Deutsch).
 */
export function offlineSeite(de: OfflineTexte, en: OfflineTexte): string {
  const nur = ({ app_name, offline_title, offline_text, offline_retry }: OfflineTexte) => ({
    app_name,
    offline_title,
    offline_text,
    offline_retry,
  });
  const texte = JSON.stringify({ en: nur(en) }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${FARBE_HELL}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${FARBE_DUNKEL}" media="(prefers-color-scheme: dark)">
<title>${html(de.offline_title)} · ${html(de.app_name)}</title>
<style>
:root{color-scheme:light dark;--bg:${FARBE_HELL};--fg:#09090b;--muted:#68686f;--border:#e4e4e7;--primary:#18181b;--onprimary:#fafafa}
@media (prefers-color-scheme:dark){:root{--bg:${FARBE_DUNKEL};--fg:#fafafa;--muted:#a1a1aa;--border:#27272a;--primary:#fafafa;--onprimary:#18181b}}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:0 16px}
main{max-width:24rem;border:1px solid var(--border);border-radius:.5rem;padding:1.5rem;display:flex;flex-direction:column;gap:1rem}
h1{margin:0;font-size:1.5rem}p{margin:0;color:var(--muted)}
button{height:2.25rem;border:0;border-radius:.375rem;background:var(--primary);color:var(--onprimary);font:inherit;font-weight:500;cursor:pointer}
</style>
</head>
<body>
<main>
<span id="app">${html(de.app_name)}</span>
<h1 id="titel">${html(de.offline_title)}</h1>
<p id="text">${html(de.offline_text)}</p>
<button id="nochmal" type="button">${html(de.offline_retry)}</button>
</main>
<script>
(function(){var t=${texte};var s=(navigator.languages||[navigator.language]).find(function(l){return /^(de|en)\\b/i.test(l)});
if(s&&/^en/i.test(s)){document.documentElement.lang="en";document.title=t.en.offline_title+" · "+t.en.app_name;
["titel","text"].forEach(function(id){document.getElementById(id).textContent=t.en[id==="titel"?"offline_title":"offline_text"]});
document.getElementById("nochmal").textContent=t.en.offline_retry}
document.getElementById("nochmal").addEventListener("click",function(){location.reload()})})();
</script>
</body>
</html>
`;
}
