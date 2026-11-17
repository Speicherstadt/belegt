# Gestaltung von Belegt

Regeln für alles, was man in Belegt sieht und bedient. Vor jeder Arbeit an der Oberfläche lesen. Der Aufbau folgt dem
[DESIGN.md-Format](https://github.com/google-labs-code/design.md) von Google Labs und ist an die Gestaltungsregeln von
Haben angelehnt, aber ohne YAML-Block mit Tokens: Die Werte stehen in `src/styles.css`, eine Kopie hier würde
auseinanderlaufen.

**Stand:** Farben, `--bg` bis `--onprimary` und der Dunkelmodus gibt es heute. Alles mit „Vorschlag“ (`--field-border`, die Schriftstufen, die Reihenfolge der Knöpfe,
`--control-h`, die Fokusregel, die Bausteine) steht noch nicht im Code. Jeder Umsetzungs-Pull-Request führt seinen
Teil ein und streicht hier das „Vorschlag“. Ändert sich eine Gestaltungsregel, ändert sich diese Datei im selben Pull
Request.

**Stand Bestätigung:** `ConfirmDialog` gibt es heute (nicht mehr Vorschlag), eingesetzt bei „Jetzt löschen“ und „Löschung bestätigen“.

## Überblick

Belegt soll verständlich, ruhig und nachvollziehbar sein, auch für Menschen mit Autismus, ADHS oder wenig IT-Erfahrung:
Wer klickt, weiß vorher, was passiert, und sieht danach, was passiert ist. Maßstab ist WCAG 2.2 AA; axe bleibt bei 0
Verstößen. Die Oberfläche ist React mit Tailwind-Utilities, ohne Komponentenbibliothek und ohne eigene Klassen: Regeln
stehen hier als Utility-Klassen und CSS-Variablen.

## Farben und Themes

Farben kommen aus den Variablen in `:root` von `src/styles.css` und sind als Tailwind-Farben freigegeben (`bg-bg`,
`text-muted`, `border-border` …). Hell ist die Vorgabe; dunkel gilt nach dem Gerät oder mit `data-theme="dark"`, hell
erzwingt `data-theme="light"`. Der Dunkelmodus hat dieselben Rollen; neue Farben kommen als Token, nicht als feste
Hexwerte oder Paletten-Klassen im Markup, sonst fehlt ihnen der Dunkelmodus.

| Token | Rolle | hell | dunkel |
| --- | --- | --- | --- |
| `--bg` | Seitengrund, Felder | `#ffffff` | `#09090b` |
| `--side` | Seitenleiste | `#fafafa` | `#0c0c0e` |
| `--subtle` | Fläche für Hinweise, Hover, Tabellenkopf | `#f4f4f5` | `#18181b` |
| `--fg` | Text, Fokusring | `#09090b` | `#fafafa` |
| `--muted` | Nebentext, Beschriftung | `#68686f` | `#a1a1aa` |
| `--border` | Linien von Karten und Trennern, **nicht** von Bedienelementen | `#e4e4e7` | `#27272a` |
| `--primary`, `--onprimary` | Hauptknopf und seine Schrift | `#18181b`, `#fafafa` | `#fafafa`, `#18181b` |
| `--field-border` (Vorschlag) | Rand von Eingabefeldern, Auswahllisten, Checkboxen, Radios | `#85858e` | `#71717a` |

**Feldrand.** `--border` hat gegen `--bg` nur 1,27 : 1 (hell) und 1,34 : 1 (dunkel). Für den Rand eines Bedienelements
verlangt WCAG 1.4.11 mindestens 3 : 1. `--field-border` erreicht das in beiden Modi, auch auf `--subtle`:

| Paar | Kontrast |
| --- | --- |
| hell `--field-border` auf `--bg` / `--subtle` | 3,66 : 1 / 3,33 : 1 |
| dunkel `--field-border` auf `--bg` / `--subtle` | 4,12 : 1 / 3,67 : 1 |
| hell / dunkel `--muted` auf `--bg` | 5,53 : 1 / 7,76 : 1 |
| hell / dunkel `--muted` auf `--subtle` | 5,03 : 1 / 6,91 : 1 |
| `--onprimary` auf `--primary` (beide Modi) | 16,97 : 1 |

Karten und Trennlinien behalten `--border`: Sie tragen keine Bedeutung, ein Bedienelement erkennt man an `--field-border`.

**Gefahr und Hinweis.** Im Code stehen heute Fehlertext in `text-red-700 dark:text-red-400` (6,47 : 1 auf Weiß,
7,19 : 1 auf `#09090b`) und Hinweiskästen mit `border-amber-600` auf `bg-subtle` (`AccountPage.tsx`), in `ProcedurePage.tsx:92` mit `border-amber-600/40 bg-amber-50` (im Dunkelmodus `bg-amber-950`). Beides sind keine Tokens. Offen
(siehe unten): ob es Tokens `--danger` und `--warn` werden. Farbe allein trägt nie die Bedeutung: Ein Fehler hat immer
Text, ein Status ein Wort oder Symbol.

## Zielgrößen

Heute sind Knöpfe und Felder meist `h-9` (36 px), an 41 Stellen `h-8` (32 px), Checkboxen `size-4` (16 px).

Vorschlag:

- Token `--control-h`: 40 px am Desktop, 44 px bei `@media (pointer: coarse)`. Er gilt für Knöpfe, Felder und
  Auswahllisten; in Tailwind als `h-(--control-h)`, nicht mehr `h-8` oder `h-9`.
- Checkboxen und Radios 20 px (`size-5`), immer mit klickbarem `<label>`. Die Trefferfläche ist am Handy mindestens
  44 × 44 px (das Label gehört zur Fläche).
- Kein Ziel unter 24 px, auch nicht das × an einem Tag (WCAG 2.5.8). Zwischen kleinen Zielen mindestens 8 px.

## Schrift

Schrift ist Geist (`--font-sans`). Vorschlag, Stufen nur diese: 12, 14, 16, 18 und 24 px (`text-xs`, `text-sm`, `text-base`,
`text-lg`, `text-2xl`). Kein `text-[10px]` und kein `text-[15px]` (heute je einmal in `Thumbnail.tsx` und `Sidebar.tsx`).

| Stufe | Wofür |
| --- | --- |
| 12 px | nur Nebenangaben: Datum, Größe, Zähler, MIME-Typ |
| 14 px | Fließtext, Tabellen, Hilfetexte, jede Hilfe, die eine Regel trägt („Eine Notiz lässt sich nicht ändern“) |
| 16 px | Felder und Knöpfe auf dem Handy (iOS zoomt sonst bei Fokus), Einleitungssatz |
| 18 px | Kartentitel |
| 24 px | Seitentitel (`h1`, genau einer je Seite) |

- Fließtext hat höchstens etwa 70 Zeichen Zeilenlänge: `max-w-prose` als Empfehlung.
- Prüfwerte, Hashes und Token stehen in `font-mono` mit `overflow-wrap: anywhere` (`break-all` genügt nicht für
  Wörter in Sätzen); Flex-Eltern bekommen `min-w-0`, sonst wächst die Seite seitwärts (Messung aus Issue #3, Playwright bei 390 px Breite: Verfahrensdoku 519 px,
  Dokumentseite 438 px bei 390 px Breite).
- Kein Text in Versalien mit Sperrung; Beschriftungen in Satzschreibung.

## Fokus

Vorschlag: eine globale Regel in `styles.css`.

```css
:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
```

- **Knöpfe, Links, Checkboxen:** 2 px Ring in `--fg` mit 2 px Abstand, so entsteht er im Hell- wie im Dunkelmodus.
- **Felder:** Der Ring liegt auf dem eigenen Rand, der sich in `--fg` färbt (`focus-visible:border-fg`,
  Ring ohne Abstand): kein Doppelrahmen.
- Nie `outline-none` ohne Ersatz. Heute fehlt der Ersatz im Suchfeld des Archivs (`DocumentList.tsx`): Der Rahmen
  (`focus-within:border-fg` am umgebenden Label) muss mitkommen.
- Nach einem Seitenwechsel steht der Fokus auf der Überschrift (offen, siehe unten).

## Knöpfe

| Art | Klassen heute | Wofür |
| --- | --- | --- |
| Hauptaktion | `bg-primary text-onprimary` | Eine je Karte |
| Normal | `border border-border` (Vorschlag: `border-field-border`) | alles übrige |
| Gefahr | heute `bg-red-700 text-white` (6 Stellen: `TagsAdmin.tsx:83`, `AccessUsers.tsx:74` und `:92`, `FieldsAdmin.tsx:64`, `DoctypesAdmin.tsx:69`, `CorrespondentsAdmin.tsx:84`); Vorschlag für den auslösenden Knopf: `border-red-700 text-red-700 dark:border-red-400 dark:text-red-400` | Löschen, Widerrufen, Entfernen |

- Vorschlag, Reihenfolge in einer Knopfzeile: Die Hauptaktion steht als **letzter** Knopf rechts, Nebenaktionen und „Abbrechen“
  davor. Ein Gefahrknopf steht neben einer Hauptaktion ganz vorn links, so weit wie möglich von ihr: Ein knapp
  verfehlter Klick trifft dann etwas Harmloses.
- Die Tab-Reihenfolge ist die des Markups und gleicht der sichtbaren (WCAG 1.3.2, 2.4.3): kein `order`, kein
  `flex-direction: row-reverse`, kein positiver `tabindex`.
- Der Text ist ein Verb mit Objekt: „Dokument hochladen“, „Jetzt löschen“, „Tag anlegen“. Nie „OK“, „Ja“, „Weiter“
  allein. Bei Aktionen, die etwas Endgültiges tun, steht im Knopf, was geschieht.
- Ein gesperrter Knopf (`disabled`) ist nur erlaubt, wenn der Grund sichtbar daneben steht („Läuft …“, „Nichts
  geändert“) oder die Aktion gerade läuft. Fehlt eine Angabe, bleibt der Knopf bedienbar und die Meldung steht am Feld.
- Ein Knopf, der nur ein Symbol zeigt, hat `aria-label`.

## Bausteine

Die Bausteine sind Vorschläge, die in eigenen Pull Requests entstehen. Sie nutzen die Texte aus Paraglide.

### Bestätigung

Die Komponente `ConfirmDialog` (`src/components/ConfirmDialog.tsx`) nutzt das native `<dialog>` (`showModal()`); Fokusfalle,
Escape und die Rückkehr des Fokus zum auslösenden Knopf liefert der Browser. Sie fragt vor Endgültigem, das sonst mit
einem Klick liefe. Heute im Einsatz: „Jetzt löschen“ bei Dokumenten, die immer frei abgelegt waren, und „Löschung bestätigen“ (Stufe 2,
auf Dokumentseite und unter Fristen). **Noch ohne Rückfrage** (Vorschlag, je ein eigener Pull Request): „Sperre aufheben“,
Workflow löschen, Token widerrufen, Passkey entfernen und die zweistufigen Inline-Bestätigungen bei Tags, Zugängen,
Feldern, Dokumenttypen und Korrespondenten, wo ein roter Knopf den ersten ersetzt, ohne „Abbrechen“.

- **Titel als Frage:** „Dokument jetzt löschen?“
- **Folgesatz:** was passiert, was bleibt und ob es sich umkehren lässt: „Das Dokument wird endgültig gelöscht. Prüfwert
  und Verlauf bleiben. Das lässt sich nicht rückgängig machen.“ (Stufe 2: „… lässt sich nicht wiederherstellen“). Der Satz sagt
  nichts über die Datei selbst, denn ihr Prüfwert und Speicher folgen eigenen Regeln.
- **Knöpfe:** „Abbrechen“ und das Verb („Jetzt löschen“). Der Fokus startet auf „Abbrechen“; Escape bricht ab; der
  Fokus kehrt zum auslösenden Knopf zurück. Läuft die Aktion, sind beide Knöpfe gesperrt und Escape bleibt wirkungslos.
- **Stufe 1:** alles Endgültige. **Stufe 2** für besonders Folgenschweres (jede „Löschung bestätigen“ eines offenen Antrags, Löschaktion
  im Postfach): zusätzlich ein Pflicht-Häkchen (Prop `haken`, Satz wie `mailbox_delete_confirm` in `MailboxAction.tsx`); der
  Bestätigen-Knopf ist erst mit Häkchen bedienbar, und der Grund steht daneben. Heute: „Löschung bestätigen“.
- **Umkehrbares fragt nicht,** es bietet „Rückgängig“ (Tag entfernen, Vorschlag übernehmen).
- Wer bei einem offenen Löschantrag allein arbeitet (kein weiteres Konto als Inhaber oder Steuerberatung), sieht zusätzlich zu
  „Eine zweite Person bestätigt“ einen Satz mit Link zu „Zugänge“, wo sich z. B. die Steuerberatung einladen lässt; stammt der Antrag von einem anderen Akteur, darf er selbst bestätigen und sieht den Satz nicht. Das Vier-Augen-Prinzip bleibt bewusst so.

### Meldung in drei Teilen

Jede Meldung beantwortet: **Was ist passiert?** · **Ist etwas verloren?** · **Was kannst du tun?** (mit Knopf,
z. B. „Erneut versuchen“). Den Rohtext des Servers gibt es eingeklappt unter „Details“, nie allein.

> Der Server antwortet gerade nicht. Deine Dokumente sind nicht verloren. [Erneut versuchen]

- Fehler an einem Feld: Text direkt unter dem Feld mit `role="alert"`, am Feld `aria-describedby` und
  `aria-invalid`; kein Browser-Blasentext in fremder Sprache. Der Fokus geht auf das erste fehlerhafte Feld.
- Erfolg: ein Satz in `role="status"`, der nach weiteren Änderungen verschwindet.
- Der Router bekommt `defaultNotFoundComponent` und `defaultErrorComponent` (heute beide nicht gesetzt); die Shell
  bleibt bei einem Fehler von `/api/ich` nicht bei „Lädt …“ stehen.

### Leerzustand

Ein Satz und **genau ein** Knopf zur nächsten Handlung: „Noch keine Dokumente. [Dokument hochladen]“, „Noch kein
Postfach. [Postfach verbinden]“. „Keine Treffer für ‚Rechnung‘. [Filter zurücksetzen]“ ist etwas anderes als „Noch keine
Dokumente“ und darf nie wie ein leeres Archiv aussehen.

### Einmalwert

Für Token, Webhook-Geheimnis und Einladungslink, die nur einmal erscheinen: Wert in `font-mono`, umbrechend,
auswählbar; Knopf „Kopieren“ mit Rückmeldung „Kopiert“ in einer eigenen Live-Region (`role="status"`, nicht um den
Wert selbst: sonst liest ein Screenreader das Geheimnis vor); darunter in normaler Größe „Wird nur jetzt angezeigt.“

### „Was ist das?“

Ein kleiner Knopf neben dem Fachbegriff (ASN, Siegel, Hash-Kette, Sperre, Art) klappt darunter einen Satz in einfacher
Sprache auf (`<details>` oder `aria-expanded`), mit Link „Mehr im Glossar“. Umgesetzt in `src/components/WasIstDas.tsx` (`Explain`) für ASN, Siegel, Hash-Kette, Sperre und Art, je an einer Stelle:
Dokumentseite, Startseite, Fristen, Einordnung. Der Knopf hat 40 px (44 px bei Touch), der Satz steht in 16 px am Handy und
darf die Zeilen darunter schieben. In Zweispaltenlisten steht der Knopf in der Wertzelle, damit die Begriffsspalte nicht breiter wird; der Kreis um das „?“ nutzt `--muted` (mindestens 3:1). Das Glossar ist `docs/glossar.md`; der Link zeigt wie die anderen Doku-Links auf die
veröffentlichte Seite, mit einem Anker je Begriff.
Kein Hover, kein Popover: Beides erreicht weder Tastatur noch Touch zuverlässig.

## Bewegung und Reize

Kaum Animation, nie Endlosbewegung, kein Blinken. Wo etwas animiert (heute nur `transition-transform` in
`PageEditor.tsx`), gilt `motion-reduce:transition-none`; bei `prefers-reduced-motion: reduce` läuft nichts.

## Texte

Texte stehen in `messages/de.json` und `messages/en.json` (Paraglide), nie im Code. Ton: ruhig, du-Form, kurze Sätze,
Fachwort erst mit Erklärung. Jeder Seite steht ein Einleitungssatz voran. Wörter haben **eine** Bedeutung; die heutigen
Schlüssel sind uneinheitlich und werden mit dem Glossar angeglichen:

| Verb | Gilt für | heute auch |
| --- | --- | --- |
| Einordnen | Art, Tags, Frist festlegen | „Ordnung“ für die Verwaltung von Tags und Arten |
| Löschen | Endgültiges (Datei weg) | „Löschung beantragen“ bei allen außer nie anders eingeordneten frei abgelegten Dokumenten (die bekommen „Jetzt löschen“) |
| Entfernen | Zuordnung lösen, Inhalt bleibt (Tag, Seite, Passkey) | „Entziehen“, „Zurückziehen“ |
| Widerrufen | Zugriff beenden (Token, Teilen-Link, Einladung) | „Zurückziehen“, „Entziehen“ |
| Aufheben | nur die Sperre | |
| Abbrechen | Vorgang verlassen, nichts ändert sich | fehlt bei mehreren zweiten Stufen |

Zahlen mit Einzahl und Mehrzahl („1 Dokument“, „2 Dokumente“) getrennt, nie „1 Dokumente“; ein Satz steht ganz in
einem Text, nicht über zwei Felder verteilt.

## Offen

Das soll der Maintainer entscheiden:

- Werden Gefahr und Hinweis Tokens (`--danger`, `--warn`), und gibt es Knopfart „Gefahr“ als Komponente oder nur als
  Klassen?
- Springt der Fokus nach dem Seitenwechsel auf die Überschrift?
- Sind 40/44 px für `--control-h` und 20 px für Checkboxen so recht, oder bleibt die Oberfläche kompakter?
- Ob eine Einstellung „größere Schrift“ oder „ruhige Ansicht“ unter „Konto“ gewünscht ist.
- Verben der Tabelle oben: Stimmt die Zuordnung, bevor `de.json` und `en.json` angeglichen werden?
