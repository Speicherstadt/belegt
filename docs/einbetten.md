# Anmelden über einen Anbieter und Einbetten

Belegt kann sich über einen OpenID-Connect-Anbieter anmelden lassen (das Firmenkonto: ein Portal, Microsoft Entra,
Google, Keycloak) und sich als Seite in einem Frame einer anderen Seite zeigen. Beides ist offen beschrieben; Belegt
kennt keine bestimmte andere App.

## Anmelden über einen Anbieter

Beim Anbieter registrierst du Belegt als Client mit der Weiterleitungsadresse `<BELEGT_URL>/api/auth/callback/oidc` und
setzt `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` und optional `OIDC_NAME` (der Name auf dem Knopf, Vorgabe
„Firmenkonto“). Belegt liest den Anbieter aus `<OIDC_ISSUER>/.well-known/openid-configuration`, meldet sich mit
Authorization Code und PKCE an und prüft das ID-Token gegen die Schlüssel des Anbieters.

Zugänge entstehen weiter nur mit Einladung. Wer schon ein Konto hat, verbindet es einmal: mit E-Mail und Passwort
anmelden, unten links „Mit … verbinden“. Danach meldet „Anmelden mit …“ auf der Anmeldeseite direkt an; Belegt erkennt
die Person an ihrer festen Kennung beim Anbieter (`sub`), nicht an der Adresse. Eine Verknüpfung allein über die
Adresse gibt es nicht: Belegt bestätigt keine Adressen, und wer einen Einladungslink öffnet, wählt seine Adresse selbst.
Ob der Anbieter die Adresse als bestätigt meldet, spielt deshalb keine Rolle. Tokens des Anbieters speichert Belegt nicht.

## Einbetten

`BELEGT_EMBED_ORIGIN` nennt die eine Seite, die Belegt in einem Frame zeigen darf (`https://portal.firma.de`). Belegt
setzt dann `Content-Security-Policy: frame-ancestors 'self' <Origin>`; ohne die Variable lässt sich Belegt nur in sich
selbst einbetten. Damit die Anmeldung im Frame gilt, liegen beide unter einer Domain (`portal.firma.de`,
`belegt.firma.de`), sonst schickt der Browser das Cookie im Frame nicht mit.

Die Seite öffnet den Frame mit `?embedded=1`. Belegt gilt nur im Frame, nur mit gesetztem Origin und nur so geöffnet als
eingebettet und merkt es sich für den Frame. Dann zeigt es weder seinen Namen noch das Konto und die Abmeldung (die
hat die einbettende Seite), und es meldet sich einmal still über den Anbieter an (`prompt=none`), wenn niemand
angemeldet ist; hat die Person dort keine Sitzung, erscheint die Anmeldeseite.

### Nachrichten

Jede Nachricht ist ein Objekt mit `type`. Belegt nimmt sie nur vom Elternfenster unter `BELEGT_EMBED_ORIGIN` an und
schickt sie nur dorthin, mit `source: "belegt"`.

| Von | `type` | Was |
| --- | --- | --- |
| Belegt | `ready` | Die App läuft; die Seite kann das Design schicken |
| Belegt | `route` | Die gezeigte Seite (`path`) |
| Belegt | `title` | Der Titel der gezeigten Seite (`title`) |
| Belegt | `signed-out` | Antwort auf `logout` |
| Seite | `theme` | `theme`: `light` oder `dark` |
| Seite | `navigate` | Eine Seite von Belegt öffnen (`path`; nur Pfade von Belegt, nie eine andere Seite) |
| Seite | `logout` | Belegt meldet ab und antwortet mit `signed-out` |

Zwischen den Servern nutzt die andere Seite API-Tokens, Webhooks und MCP ([`schnittstelle.md`](schnittstelle.md)).
