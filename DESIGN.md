# Gestaltung von Belegt

Regeln für alles, was man in Belegt sieht und bedient. Vor jeder Arbeit an der Oberfläche lesen. Der Aufbau folgt dem
[DESIGN.md-Format](https://github.com/google-labs-code/design.md) von Google Labs und ist an die Gestaltungsregeln von
Haben angelehnt, aber ohne YAML-Block mit Tokens: Die Werte stehen in `src/styles.css`, eine Kopie hier würde
auseinanderlaufen. Nur Tokens, die dort noch fehlen, stehen mit Wert unter „Neue Tokens“.

**Stand:** Im Code stehen heute die Farben `--bg` bis `--onprimary` samt `--ok`, `--warn` und `--danger`, der
Dunkelmodus, die Fokusregel, der Umbruch langer Prüfwerte, der Leerzustand von Archiv und Eingang und die Bausteine
`ConfirmDialog`, `Einmalwert`, `WasIstDas` und `SelectionBar`. Alles, was mit „Vorschlag“ steht (ein Abschnitt trägt es in
der Überschrift), steht noch nicht im Code oder weicht von ihm ab. Grundlage ist Issue #3; Umsetzungs-Pull-Requests
(zum Beispiel zu #57, #58, #59) führen jeweils ihren Teil ein und streichen das „Vorschlag“.

## Überblick

Belegt soll verständlich, ruhig und nachvollziehbar sein, auch für Menschen mit Autismus, ADHS oder wenig IT-Erfahrung:
Wer klickt, weiß vorher, was passiert, und sieht danach, was passiert ist. Maßstab ist WCAG 2.2 AA; axe bleibt bei 0
Verstößen. Die Oberfläche ist React mit Tailwind-Utilities, ohne Komponentenbibliothek und ohne eigene Klassen: Regeln
stehen hier als Utility-Klassen und CSS-Variablen. Marke ist der Name mit der Unterzeile „Belegt ist, was du beweisen
kannst.“ (`app_claim`).

## Raster und Abstände (Vorschlag)

- Grundeinheit 4 px, Rhythmus 8 px. Erlaubt sind nur die Tailwind-Stufen `1, 2, 3, 4, 6, 8, 12, 16` (4, 8, 12, 16, 24,
  32, 48, 64 px); kein `gap-0.5`, `gap-2.5`, `px-2.5`.
- Nähe zeigt Zusammengehörigkeit, außen ist immer größer als innen: 8 px in der Gruppe, 16 zwischen Feldern, 24 zwischen
  Gruppen und Karten, 48 zwischen Seitenblöcken.
- Zahlen außerhalb der Skala nur als Formel aus Skala und Zielgröße: Mitte in der Zeile `(--control-h − 20) / 2` bzw.
  `(--control-h − 16) / 2` (10 bis 14 px); Innenabstand eines Feldes mit Symbol links 12 + 16 + 8 = 36 px, rechts
  `--control-h`; Segmente ohne Innenabstand; Trefferfläche `inset: -10px`.

## Layout (Vorschlag)

- Spalten: 4 am Handy, 8 am Tablet, 12 am Desktop; Rinne überall 16 px (bei 1440 px sind Spalten 80 px breit).
- Seitenrand 16 px am Handy, 24 px ab 768 px. Der Inhalt ist höchstens 1136 px breit (12 × 80 + 11 × 16) und mittig;
  1136 + 2 × 24 + 256 Seitenleiste = 1440.
- Seitenleiste: 256 px über die volle Seitenhöhe (`sticky`, `100dvh`), dauerhaft erst ab `lg` (1024 px; heute ab `md`).
  Bei 768 px blieben neben ihr nur 512 px für den Inhalt.
- Detailseiten sind ab `xl` (1280 px) zweispaltig, 5 + 7 Spalten, sonst eine Spalte; bei 1024 px hätte die Einordnung
  nur 289 px. Das ändert die Spaltenfolge der Dokumentseite (heute Vorschau zuerst, ab `lg` zweispaltig): Links
  steht die Einordnung, rechts Vorschau, Prüfwerte, Löschung. Tab-Reihenfolge: erst die linke Spalte, dann die rechte.
- Formulare einspaltig höchstens `36rem`, ab 768 px zweispaltig (6 + 6 Spalten). Fließtext höchstens `65ch`.
- Die Archivliste zeigt unter 1024 px weder Typ noch Größe; der Name ist mindestens `14rem` breit, damit er nicht mitten
  im Wort bricht. Die Filterzeile steht unter 768 px so: Suche in eigener Zeile, Art und Tags darunter, je halbe Breite.

## Schrift

Schrift ist Geist (`--font-sans`); Prüfwerte stehen in der System-Monospace, ohne neue Abhängigkeit. Vorschlag, Stufen
nur diese: 12, 14, 16, 18 und 24 px (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-2xl`) mit festen Zeilenhöhen
16, 20, 24, 24 und 32 px (`text-lg/6`; alles liegt auf dem 4-px-Raster). Kein `text-[10px]` und kein `text-[15px]` (heute
noch einmal in `Sidebar.tsx`). Gewichte nur 400, 500 und 600; Hierarchie entsteht aus Größe, Gewicht und Abstand.
Die Rollen und Zeilenhöhen sind Vorschlag; `PageHeader.tsx` setzt den Titel heute anders.

| Rolle | Größe / Zeile / Gewicht | Wofür |
| --- | --- | --- |
| Titel | 24/32/600 | Seitentitel im Inhalt |
| Kopf | 18/24/600 | Seitentitel in der Kopfleiste, Kartentitel |
| Unterkopf | 16/24/600 | Zwischenüberschrift |
| Lesen | 16/24 | Einleitungssatz, Folgesatz im Dialog, Satz bei „Was ist das?“ |
| Text | 14/20 | Fließtext, Tabellen |
| Beschriftung | 14/20/500 | Feldbeschriftung |
| Hilfe | 14/20 `--muted` | Hilfetexte, jede Hilfe, die eine Regel trägt („Eine Notiz lässt sich nicht ändern“) |
| Nebenangabe | 12/16 `--muted` | Datum, Größe, Zähler, MIME-Typ, Grund eines gesperrten Knopfes |
| Prüfwert | Monospace | Hashes, Token |

- **Seitentitel an zwei Orten, nie an beiden** (Vorschlag): als Kopf in der Kopfleiste, als Titel im Inhalt (Dokument,
  Meldungsseiten). Unter 1024 px ist die Kopfleiste weg; der Titel steht dann als sichtbare `h1` (Kopf) am Anfang des
  Inhalts. Auf der Dokumentseite ist der Dokumentname die `h1`. Genau eine `h1` je Seite, nie zwei zugleich sichtbar.
- Felder und Knöpfe haben bei `pointer: coarse` 16 px, weil iOS sonst bei Fokus zoomt, auch auf dem iPad (Vorschlag; heute
  `text-base sm:text-sm` nach Breite).
- Ziffern in Tabellen `tabular-nums`; die Kennzahl-Kacheln der Startseite proportional.
- Prüfwerte, Hashes und Token haben `break-all` (`DocumentDetails.tsx`, `AuditPage.tsx`). Fließtext und Überschriften
  (Text der Verfahrensdokumentation, `PageHeader`) brechen mit `[overflow-wrap:anywhere]` um, damit Wörter in Sätzen
  nicht mitten zerrissen werden, wo es nicht nötig ist. Flex-Eltern bekommen `min-w-0`, sonst wächst die Seite seitwärts
  (Messung aus Issue #3, Playwright bei 390 px Breite: Verfahrensdoku 519 px, Dokumentseite 438 px).
  `e2e/umbruch-fokus.spec.ts` prüft beides.
- Kein Text in Versalien mit Sperrung; Beschriftungen und Gruppennamen im Menü in Satzschreibung.

## Farben und Themes

Farben kommen aus den Variablen in `:root` von `src/styles.css` und sind als Tailwind-Farben freigegeben (`bg-bg`,
`text-muted`, `border-border` …). Hell ist die Vorgabe; dunkel gilt nach dem Gerät oder mit `data-theme="dark"`, hell
erzwingt `data-theme="light"`. Der Dunkelmodus hat dieselben Rollen; neue Farben kommen als Token, nicht als feste
Hexwerte oder Paletten-Klassen im Markup, sonst fehlt ihnen der Dunkelmodus. Alle Textpaare erreichen mindestens 4,5 : 1.

| Token | Rolle |
| --- | --- |
| `--bg` | Seitengrund, Felder |
| `--side` | Seitenleiste |
| `--subtle` | Fläche für Hinweise, Hover, Tabellenkopf, gesperrte Felder |
| `--fg` | Text, Fokusring |
| `--muted` | Nebentext, Beschriftung, Info-Symbol |
| `--border` | Linien von Karten und Trennern, **nicht** von Bedienelementen |
| `--primary`, `--onprimary` | Hauptknopf und seine Schrift, gewählter Zustand |
| `--field-border` (Vorschlag) | Rand aller Bedienelemente: Felder, Auswahllisten, Checkboxen, Radios, Segmente |
| `--danger` | Fehler, Gefahr: Text, Rand, Symbol auf `--bg` und `--subtle` |
| `--warn` | Warnung: Symbol und Titel; der Kasten bleibt `--subtle` |
| `--ok` | Erfolg und Geprüft: nur Symbol und Text |

Kontrast: `--muted` auf `--bg` / `--subtle` 5,53 / 5,03 : 1 hell, 7,76 / 6,91 : 1 dunkel; `--onprimary` auf `--primary`
16,97 : 1; `--danger` auf `--bg` / `--subtle` 6,47 / 5,89 : 1 hell, 7,19 / 6,40 : 1 dunkel; `--warn` 5,02 / 4,57 : 1 hell,
11,92 / 10,61 : 1 dunkel; `--ok` 5,02 / 4,56 : 1 hell.

**Feldrand.** `--border` hat gegen `--bg` nur 1,27 : 1 (hell) und 1,34 : 1 (dunkel); WCAG 1.4.11 verlangt für den Rand
eines Bedienelements mindestens 3 : 1. `--field-border` erreicht das in beiden Modi, auch auf `--subtle` (hell 3,66 /
3,33 : 1, dunkel 4,12 / 3,67 : 1). Karten und Trennlinien behalten `--border`: Sie tragen keine Bedeutung.

**Gefahr, Hinweis, Info (Vorschlag).** Heute stehen Fehlertext in `text-red-700 dark:text-red-400` und Hinweiskästen mit
`border-amber-600` (`AccountPage.tsx`, `ProcedurePage.tsx`); beides wird `--danger` und `--warn`. Info hat keine Farbe,
nur ein Symbol in `--muted`; `--c-blue` gehört allein dem Punkt „Pflicht“. Farbe allein trägt nie die Bedeutung: Ein
Fehler hat immer Text, ein Status ein Wort oder Symbol.

**Zustand der Siegel.** Der Prüfstatus (`SealBadge.tsx`) ist eine Zeile mit Schild-Symbol: Haken in `--ok` (letzter Lauf
frisch und ohne Befund), ! in `--warn` (noch nicht geprüft oder älter als 48 Stunden), ✕ in `--danger` (Befund). Nur das
Symbol ist farbig, der Satz bleibt neutral. Startseite und Prüfung zeigen dieselbe Zeile. Grün steht nur dort, wo Belegt
etwas geprüft hat; ein bloßes „gespeichert“ ist kein Grün. Vorschlag: Die Zeile ist eine Fläche auf `--subtle` ohne Rand
(heute `border bg-subtle`) mit den Lucide-Symbolen `shield-check`, `shield-alert`, `shield-x` statt des eigenen Schilds;
im Kopf eines Dokuments steht sie als Etikett.

**Gesperrt** (`disabled`, Vorschlag) heißt `opacity-50` (heute `opacity-60` und `-40` gemischt), und der Grund steht immer
als Text daneben: Gesperrtes ist vom Kontrast ausgenommen, der Grund nicht.

### Neue Tokens (Vorschlag)

| Token | hell | dunkel | Zweck |
| --- | --- | --- | --- |
| `--field-border` | `#85858e` | `#71717a` | Rand von Bedienelementen |
| `--scrim` | `rgb(9 9 11 / 0.5)` | `rgb(0 0 0 / 0.6)` | Fläche hinter Dialogen, statt `bg-black/50` |
| `--shadow-float` | `0 1px 2px rgb(9 9 11 / 0.06), 0 4px 16px rgb(9 9 11 / 0.1)` | `0 1px 2px rgb(0 0 0 / 0.4), 0 4px 16px rgb(0 0 0 / 0.5)` | Schwebendes: Popover, Auswahlleiste, Menü-Fläche |
| `--shadow-dialog` | `0 8px 32px rgb(9 9 11 / 0.18)` | `0 8px 32px rgb(0 0 0 / 0.6)` | Dialog |

Dazu kommen `--control-h` (40 px, bei `pointer: coarse` 44 px) und `--row-h` (44 px, bei Kompakt 36 px, siehe Tabellen).

## Linien, Rundungen, Ebenen (Vorschlag)

- **Mittel:** erst Abstand, dann Linie, dann Fläche; nie Linie und Fläche am selben Element (Siegel, Einmalwert,
  Einordnung haben heute beides).
- **Linien:** 1 px `--border`, 1 px `--field-border`, 2 px `--fg` (Fokus, aktiver Reiter).
- **Rundungen:** 0, 4 (Teile), 6 (Bedienelemente), 8 (Behälter); voll nur Radio und Punkt. Keine Pillen: Zähler und
  Siegel-Etikett sind `rounded-md`.
- **Kopfleiste** deckend in `--bg`, ohne Glas (heute `bg-bg/85 backdrop-blur`).
- **Schatten** nur für Schwebendes: Popover, Auswahlleiste, Menü-Fläche (`--shadow-float`) und Dialog
  (`--shadow-dialog`). Ein Schatten sagt „liegt oben“.
- **Z-Index** nur diese Folge: 10 Tabellenkopf, 20 Leisten, 30 Auswahlleiste, 40 Popover und Menü-Fläche, 50 Dialog,
  60 Sprunglink.

## Zielgrößen (Vorschlag)

- `--control-h` gilt für Knöpfe, Felder, Auswahllisten, Reiter, Menüeinträge, Auswahlleiste, Tabellenkopf und den Knopf
  eines Dateifelds; in Tailwind `h-(--control-h)`, nicht mehr `h-8` oder `h-9`.
- Nur-Symbol-Knöpfe 40 × 40, am Touch 44 × 44, mit `aria-label`. Sortierknöpfe, Segmente, Auswahlleiste und Sprunglink
  am Touch ebenfalls 44 × 44 (`min-w-(--control-h)`); ein Titel-Link in der Tabelle mindestens 24 px hoch.
- Checkboxen und Radios sehen überall gleich aus, nicht wie im Browser (zentral in `src/styles.css`, keine eigenen
  Klassen): 20 px (`size-5`), gewählt `--primary` mit Haken oder Punkt in `--onprimary`. Das `<label>` ist immer
  klickbar und gehört zur Fläche (`--control-h` hoch).
- Das × an einem Tag ist sichtbar 24 × 24, die Trefferfläche am Touch 44 × 44 (`after:absolute after:-inset-2.5`; beim
  Tag als Link mit Rand `-inset-[11px]`). Kein Ziel unter 24 px (WCAG 2.5.8), zwischen kleinen Zielen mindestens 8 px.
- Ein Knopf in einer Formularzeile mit `items-end` hat kein `self-start`, sonst steht er höher als die Felder.
- Verwaltungsseiten (Quellen, Workflows): Jeder Abschnitt ist eine Karte (`verwaltungsKarte`); zuerst steht, was es gibt,
  das Formular zum Anlegen erscheint erst auf „… anlegen“ (`Ausklappbar`).

## Fokus

- **Knöpfe, Links, Checkboxen:** 2 px Ring in `--fg` mit 2 px Abstand (globale Regel `:focus-visible` in `styles.css`),
  so entsteht er im Hell- wie im Dunkelmodus.
- **Felder** (Text-Eingaben, Auswahllisten, Textfelder; nicht Checkbox, Radio, Datei, Schieber): Der Ring hat keinen
  Abstand (`outline-offset: 0`) und der Rand färbt sich in `--fg`, so entsteht kein Doppelrahmen. Die globale Regel
  in `styles.css` tut genau das; die Randfarbe steht dort ungeschichtet, sonst verlöre sie gegen `border-border`.
- Nie `outline-none` ohne Ersatz. Das Suchfeld des Archivs (`DocumentList.tsx`) hat den Ersatz: `focus-within:border-fg`
  am umgebenden Label; das Suchfeld der Listen an der Auswahlleiste (`AuswahlListe.tsx`) ebenso mit `focus:border-fg`.
  Dazu `outline-hidden` statt `outline-none` am Feld: Bei erzwungenen Farben (Kontrastmodus) zeigt ein Farbwechsel des
  Rands nichts, der Ring dann schon.
- Die Tab-Reihenfolge ist die des Markups und gleicht der sichtbaren (WCAG 1.3.2, 2.4.3): kein `order`, kein
  `flex-direction: row-reverse`, kein positiver `tabindex`.
- Nach einem Seitenwechsel steht der Fokus auf der Überschrift (offen, siehe unten).

## Felder (Vorschlag)

- Beschriftung über dem Feld, nie nur ein Platzhalter. Pflicht ist der Normalfall: Das seltene Feld trägt „(optional)“,
  und ein Satz oben im Formular sagt es.
- Hilfetext unter dem Feld, ohne Kasten.
- Fehler: Text direkt unter dem Feld in `--danger` mit Symbol, `role="alert"`, am Feld `aria-describedby` und
  `aria-invalid`; kein Browser-Blasentext in fremder Sprache. Der Fokus geht auf das erste fehlerhafte Feld.
- **Gesperrt:** Fläche `--subtle`, Rand `--border`, Schrift `--muted`. **Nur lesen:** Fläche `--subtle`, normaler Rand.
- **Suchfeld:** Symbol links, Löschknopf rechts (`--control-h`), kein Browser-Kreuz.

## Knöpfe

| Art | Klassen | Wofür |
| --- | --- | --- |
| Hauptaktion | `bg-primary text-onprimary` | Genau eine je Bereich (Seite, Karte, Dialog) |
| Normal | `border border-border` (Vorschlag: `border-field-border`) | alles übrige |
| Gefahr | heute `bg-red-700 text-white` (`TagsAdmin.tsx`, `AccessUsers.tsx`, `FieldsAdmin.tsx`, `DoctypesAdmin.tsx`, `CorrespondentsAdmin.tsx`) und im `ConfirmDialog`; Vorschlag für den auslösenden Knopf: Rand und Schrift `--danger` | Löschen, Widerrufen, Entfernen |

- Vorschlag: Im Bestätigungsdialog ist der bestätigende Knopf die Hauptaktion (letzter rechts, bei Endgültigem gefüllt `bg-danger`
  statt `bg-primary`); „Gefahr ganz links“ gilt für die Knopfzeile auf der Seite neben einer Hauptaktion.
- Vorschlag: Gefährliches ist auf der Seite leise, im Dialog klar. Gefüllt (`bg-danger text-onprimary`, 6,2 : 1 hell,
  6,4 : 1 dunkel) ist nur der bestätigende Knopf im Dialog. Gedrückt mischt er 85 % mit dem Grund (4,90 : 1 hell, 4,80 : 1
  dunkel; bei 80 % wären es 4,49 und 4,34).
- Vorschlag, Reihenfolge in einer Knopfzeile: Die Hauptaktion steht als **letzter** Knopf rechts, Nebenaktionen und
  „Abbrechen“ davor. Ein Gefahrknopf steht neben einer Hauptaktion ganz vorn links, so weit wie möglich von ihr: Ein
  knapp verfehlter Klick trifft dann etwas Harmloses. Am Handy stehen die Knöpfe gestapelt, die Hauptaktion unten, wo
  der Daumen sie am leichtesten erreicht.
- Der Text ist ein Verb mit Objekt: „Dokument hochladen“, „Jetzt löschen“, „Postfach anlegen“. Nie „OK“, „Ja“, „Weiter“
  allein, nie „&“ („Einordnen und weiter“) und nie ein Plus als Ersatz des Verbs. Bei Aktionen, die etwas Endgültiges
  tun, steht im Knopf, was geschieht.
- Ein gesperrter Knopf (`disabled`) ist nur erlaubt, wenn der Grund sichtbar daneben steht („Nichts geändert“). Vorschlag:
  Der Grund hat eine eigene `id`, auf die der Knopf per `aria-describedby` verweist. Fehlt eine Angabe, bleibt der
  Knopf bedienbar und die Meldung steht am Feld.
- **Lädt** (Vorschlag): Der Knopf zeigt „Läuft …“ mit kleinem Dreher, mit `aria-busy`, nicht `disabled` oder
  `aria-disabled`; er bleibt fokussierbar, eine weitere Betätigung löst aber nichts aus. „Läuft …“ bleibt in voller Farbe (4,5 : 1, auch beim Gefahrknopf); das
  Gesperrt-Aussehen gilt nur für wirklich Gesperrtes.
- **Link-Knopf** (Vorschlag) für Dritt- und Textaktionen: unterstrichen, ohne Rand, `--control-h` hoch.
- **Segment** (Vorschlag; Darstellung, Seite, Breite): gewählt `--primary` (der aktive Filter
  ebenso).
- Ein Knopf, der nur ein Symbol zeigt, hat `aria-label`.

## Symbole

Symbole kommen aus Lucide (`lucide-react`, ISC), nie selbst gezeichnet. Sie sind einfarbig: in der Textfarbe drumherum
(Seitenleiste grau, aktiver Eintrag in `--fg`), in Beschriftungen `--muted`. Jeder Bereich hat ein festes Symbol
(`src/components/Symbole.tsx`), dasselbe in Seitenleiste, Kacheln der Startseite und leeren Seiten. Symbole sind
schmückend (`aria-hidden`); der Text daneben sagt es. Farbe gibt es nur mit Bedeutung: Siegel und Meldungen (`--ok`,
`--warn`, `--danger`) und die Punkte der Aufbewahrung (Pflicht `--c-blue`, freiwillig mit Frist `--c-amber`, frei
`--muted`). Keine Akzentfarbe: Hauptknopf und aktiver Filter bleiben `--primary`.

Vorschlag:

- Größen 16 px (Strich 2) und 20 px, sonst keine. Ausgerichtet wird mit einer Box so hoch wie die Zeile (`h-5` oder
  `h-6`), nicht mit Versatz (`mt-0.5`).
- Keine Textzeichen als Symbole (heute `☰ ✕ ×`, `?` im Kreis, `↑ ↓`): `menu`, `x`, `circle-question-mark`,
  `chevrons-up-down`, `arrow-up`, `arrow-down` für die Sortierung.
- Meldungen: `circle-x` (Fehler), `triangle-alert` (Warnung), `circle-check` (Erfolg), `info` (Info).

## Bewegung und Reize

Kaum Animation, nie Endlosbewegung, kein Blinken. Heute animiert nur `transition-transform` in `PageEditor.tsx`.

Vorschlag:

- Animiert werden nur Farbe, Deckkraft und Skalierung (Ausnahme: der Dreher des Ladeknopfs).
- Dauern: 100 ms für Farbe und Druck, 160 ms für Popover, 200 ms für Dialog und Menü; das Ausblenden dauert etwa zwei
  Drittel. Kurve für Erscheinen `cubic-bezier(0.23, 1, 0.32, 1)`, für Farbe `ease`.
- Druck: Ein Knopf skaliert beim Drücken mit dem Zeiger auf 0,97.
- Hover nur unter `@media (hover: hover)`, damit er am Touch nicht klebt.
- Was die Tastatur auslöst, wird nie animiert.
- Laden: Ein Skeleton erscheint erst nach 400 ms, ohne Schimmern.
- Bei `prefers-reduced-motion: reduce` läuft nichts. Der Dreher des Ladeknopfs steht dann still, der Text bleibt: Ein
  Fortschrittszeichen muss sich sonst bewegen, sonst wirkt der Knopf eingefroren.

## Behälter, Tabellen, Listen (Vorschlag)

- **Nie ein Kasten im Kasten und nie eine Karte in der Karte.** `Ausklappbar` öffnet ohne Kasten, mit 1 px Linie oben;
  die Einordnung hat keine vier Kästen.
- **Hinweis-Kasten** (Hinweis, Vorschau, Einmalwert, eingebettete Meldung, Fristvorschau): ein Kasten auf `--subtle`,
  ohne Rand, 8 px Rundung, Innenabstand 16 px.
- **Abschnitt** für Seiten ohne Karten: Überschrift, 1 px Linie oben, 24 px Abstand.
- **Karte:** Kartentitel als Kopf, Abstand der Teile `gap-4`.
- **Tabelle:** Zeile `--row-h` (12 + 20 + 12 px plus 1 px Trennlinie), Kopf `--control-h` hoch auf `--subtle` in
  `--muted` 500. Sortierung mit Lucide-Symbolen und `aria-sort`. Die Auswahlspalte ist 48 px breit, die ganze Zelle das
  Label. Am Handy wird die Tabelle zur Liste (Titel, Aufbewahrung, Datum), nie seitlich scrollend.
- **Dichte:** Unter „Konto“ steht ein Segment „Normal (44 px) / Kompakt (36 px)“, vorgegeben Normal, pro Konto
  gespeichert. Kompakt setzt `data-dichte="kompakt"` am Root und gilt nur mit der Maus:
  `@media (pointer: fine) { html[data-dichte="kompakt"] { --row-h: 36px } }`. Am Touch bleibt es 44 px, und der Text bei
  der Einstellung sagt das. Das Polster der Zeile ist `(--row-h − 20) / 2` (12 oder 8 px); sonst bleibt alles
  `--control-h`.
- **Liste:** Zeilen mindestens 56 px, 1 px Linie, Aktionen rechts.
- **Leerzustand:** ohne Rahmen; ein Symbol auf einer 44-px-Fläche `--subtle`, ein Satz, ein Knopf.

## Navigation (Vorschlag)

- **Seitenleiste** mit drei Gruppen: Dokumente (Start, Eingang, Archiv), Ordnen und prüfen (Ordnung, Fristen, Prüfung),
  Einrichten (Quellen, Workflows, Verfahrensdokumentation, Zugänge, Benachrichtigungen). Das Menüwort ist
  „Verfahrensdokumentation“ ausgeschrieben, gleich dem Seitentitel.
- **Zähler** nur am Eingang: gefüllt `--primary`; gespeicherte Ansichten tragen schlichten Text (heute `rounded-full
  bg-subtle` an den Ansichten).
- **Eintrag:** `--control-h` hoch, inaktiv `--muted`, aktuell `--fg` in 600 auf `--subtle`; die Fläche allein trägt nicht
  (1,1 : 1).
- **Menü unter 1024 px:** Statt der Seitenleiste steht ein Knopf „Menü“ (`aria-expanded`, Lucide `menu`, offen `x`);
  die Leiste öffnet als Fläche über dem Inhalt (`z-40`), Escape schließt, nach einem Seitenwechsel klappt sie zu.
- **Suche am Handy (unter 1024 px):** Neben „Menü“ steht ein Lupen-Knopf, 44 × 44, `aria-label="Suchen"`, `aria-expanded`,
  `aria-controls`. Er öffnet die globale Suche als Fläche über dem Inhalt (`z-40`, `--shadow-float`): Der Fokus geht ins
  Suchfeld, Escape schließt, der Fokus kehrt zum Knopf zurück, das Symbol wird zum `x`. Menü und Suche sind nie zugleich
  offen: Öffnet das eine, schließt das andere.
- **Kopfleiste** (ab 1024 px): 56 px, Linie unten, deckend, bleibt beim Scrollen stehen. Links der Titel der Seite
  (`PageHeader` stellt ihn mit `InKopfzeile` hinein), rechts die Suche (höchstens `max-w-md`) und die Glocke.
- **Seitenkopf:** Die Erklärung steht am Anfang des Inhalts als Lesen in `--muted`, die Hauptaktion rechts daneben, am
  Handy darunter. Jeder Seite steht ein Einleitungssatz voran. Die Hauptaktion steht nie in der Mitte des leeren
  Zustands und nie doppelt.
- **Reiter:** Eine Seite mit Bereichen, die nicht zusammen gebraucht werden, teilt sie in Reiter (`Reiterleiste` in
  `src/components/Reiter.tsx`): Text in `--muted`, der aktive in `--fg` mit 2 px Linie unten auf der Linie der Leiste. Der
  Reiter steht in der Adresse (`?bereich=`), damit Links und Zurück funktionieren; der vorgegebene braucht keinen.
  Rechts in der Leiste darf ein kurzer Zustand stehen (etwa „Alle Angaben sind gemacht.“). So geteilt: Ordnung, Quellen
  (Postfächer, Scannen, Umzug, Schnittstelle), Fristen (Übersicht, Sperren, Vorlagen und Fristen) und Verfahrensdoku
  (Angaben, Dokument).
- **Startseite:** Ohne sichtbaren Seitenkopf: „Start“ steht nur als `h1` für Screenreader und im Tab
  (`PageHeader versteckt`), die Überschrift „Überblick“ steht oben in der Kopfleiste; unter 1024 px ersetzt „Überblick“ als sichtbare `h1` am Anfang des Inhalts die versteckte (Vorschlag). Oben vier Kennzahl-Kacheln
  gleicher Bauart (`src/components/start/Ueberblick.tsx`): Beschriftung mit Symbol rechts, Wert, ein kleines Diagramm,
  eine Zeile darunter. Die vier Zeilen liegen in einem Subgrid, damit sie über alle Kacheln auf einer Linie stehen. Jede
  Kachel hat ihre eigene Art Diagramm, alle 32 px hoch: Archiv den Verlauf der letzten zwölf Monate als Balken
  (Vergangenheit `--muted`, laufender Monat `--fg`, Tooltip je Monat), Eingang einen kleinen Ring für den eingeordneten
  Anteil mit der Prozentzahl daneben, Speicher die Belegung des Datenträgers als Segmente wie eine Festplattenanzeige
  (Originale `--fg`, übrig belegt `--muted`, frei nur Rand) mit Legende darunter. Darunter links breit die gespeicherten
  Ansichten, rechts untereinander Unveränderbarkeit, Fristen, Quellen und Betrieb, jede Karte so hoch wie ihr Inhalt.

## Auswahl

Die Leiste für Sammelaktionen (`SelectionBar.tsx`) ist eine Zeile (48 px, ihre Knöpfe `--control-h` hoch), damit beim Anhaken nichts verrutscht: links die
Zahl und ×, nach einem Strich die Aktionen als graues Lucide-Symbol mit kurzem Wort (unter `lg` nur das Symbol, der Name
in `aria-label`). Heute schwebt sie mittig über dem Inhalt (`fixed`). Vorschlag: `sticky bottom-4` als letztes Kind des
Inhalts, damit sie nie die Pagination verdeckt, mit Rand `--border`, 8 px Rundung und `--shadow-float`.

Nie ein Formular in der Leiste und nie ein Kasten in der Seite. Tags, Korrespondent und Typ öffnen eine durchsuchbare
Liste direkt über ihrem Knopf (`AuswahlListe.tsx`): ein Klick setzt sofort; bei Tags zeigt das Kästchen alle (✓), manche
(–) oder keine, ein neuer Name legt den Tag an. Feld, Einordnen und Zusammenfügen öffnen ein Panel genau so breit wie die
Leiste und bündig darüber: oben der Titel und ×, dann der Hinweis, die Felder, unten rechts die Knöpfe. Escape oder ein
Klick daneben schließt. Am Handy stehen nur Tags, Korrespondent und Typ als Symbol in der Zeile, der Rest unter „…“
(Weitere Aktionen), das genauso über seinem Knopf aufgeht. Das Ergebnis steht danach in derselben Form an derselben
Stelle (`AuswahlMeldung`). Unter einer Kachel stehen Öffnen, Vorschau und Herunterladen als Symbole; der Text steht in
`aria-label` und `title`, weil er in die schmale Karte nicht passt.

**ARIA der Tag-Auswahl** (Vorschlag): Der Auslöser hat `aria-haspopup="menu"`, die Liste `role="menu"`, die Einträge
`role="menuitemcheckbox"` mit `aria-checked="true|false|mixed"`; „einige“ trägt zusätzlich sr-only „bei einigen
gewählt“. `role="option"` mit `aria-selected="mixed"` ist verboten (axe: ungültig).

## Tags

Ein Tag ist eine Badge mit Rand wie die Outline-Badge von shadcn/ui (`TagChip`): 24 px hoch, `rounded-md`, Rand
`--border`, Name in `--fg`. Die Farbe des Tags steht nur als Punkt davor, nie als Fläche: So bleibt die Liste ruhig, und
die Farbe hilft trotzdem beim Wiederfinden. Der Name steht immer daneben.

Vorschlag: Der Punkt hat je Modus einen Mittelton, `punkt: { hell, dunkel }` neben `hintergrund` und `schrift` in
`shared/ordnung.ts`; heute ist er hell fast schwarz und dunkel pastell, sodass Rot, Orange und Gelb kaum zu trennen
sind. Alle Töne erreichen mindestens 3 : 1 gegen `--bg` und `--subtle` ihres Modus (knappster Wert: Orange hell auf
`--subtle`, 3,24 : 1).

| Farbe | hell | dunkel |
| --- | --- | --- |
| `grau` | `#71717a` | `#a1a1aa` |
| `rot` | `#dc2626` | `#f87171` |
| `orange` | `#ea580c` | `#fb923c` |
| `gelb` | `#a16207` | `#facc15` |
| `gruen` | `#159a45` | `#4ade80` |
| `tuerkis` | `#0d9488` | `#2dd4bf` |
| `blau` | `#2563eb` | `#60a5fa` |
| `violett` | `#7c3aed` | `#a78bfa` |
| `rosa` | `#db2777` | `#f472b6` |

## Bausteine

Die Bausteine entstehen in eigenen Pull Requests; sie nutzen die Texte aus Paraglide.

### Bestätigung

Die Komponente `ConfirmDialog` (`src/components/ConfirmDialog.tsx`) nutzt das native `<dialog>` (`showModal()`); Fokusfalle,
Escape und die Rückkehr des Fokus zum auslösenden Knopf liefert der Browser. Sie fragt vor Endgültigem, das sonst mit
einem Klick liefe. Heute im Einsatz: „Jetzt löschen“ bei Dokumenten, die immer frei abgelegt waren, und „Löschung bestätigen“ (Stufe 2,
auf Dokumentseite und unter Fristen), „Postfach entfernen“ und „Webhook entfernen“ (Stufe 1, unter Quellen) sowie „Passwort zurücksetzen“ (Stufe 1, unter Zugänge). **Noch ohne Rückfrage** (Vorschlag, je ein eigener Pull Request): „Sperre aufheben“,
Workflow löschen, Token widerrufen, Passkey entfernen und die zweistufigen Inline-Bestätigungen bei Tags, Zugängen,
Feldern, Dokumenttypen und Korrespondenten, wo ein roter Knopf den ersten ersetzt, ohne „Abbrechen“.

- **Titel als Frage:** „Dokument jetzt löschen?“
- **Folgesatz** (Lesen): was passiert, was bleibt und ob es sich umkehren lässt: „Das Dokument wird endgültig gelöscht. Prüfwert
  und Verlauf bleiben. Das lässt sich nicht rückgängig machen.“ (Stufe 2: „… lässt sich nicht wiederherstellen“). Der Satz sagt
  nichts über die Datei selbst, denn ihr Prüfwert und Speicher folgen eigenen Regeln.
- **Knöpfe:** „Abbrechen“ und das Verb („Jetzt löschen“). Der Fokus startet auf „Abbrechen“; Escape bricht ab; der Fokus
  kehrt zum auslösenden Knopf zurück. Vorschlag: Am Handy stehen sie gestapelt (heute `flex-wrap justify-end`); beim
  Lauf zeigt der bestätigende Knopf „Läuft …“ mit `aria-busy` (siehe „Lädt“), „Abbrechen“ ist gesperrt, und
  Escape bleibt wirkungslos.
- **Fläche** (Vorschlag): Innenabstand 24 px (`p-6`), `--shadow-dialog`, dahinter `--scrim`.
- **Stufe 1:** alles Endgültige. **Stufe 2** für besonders Folgenschweres (jede „Löschung bestätigen“ eines offenen Antrags, Löschaktion
  im Postfach): zusätzlich ein Pflicht-Häkchen (Prop `haken`, Satz wie `mailbox_delete_confirm` in `MailboxAction.tsx`); der
  Bestätigen-Knopf ist erst mit Häkchen bedienbar. Der Grund steht darunter (Vorschlag), damit er in 400 px Breite passt:
  „Löschung bestätigen geht erst nach dem Häkchen.“
- **Umkehrbares fragt nicht,** es bietet „Rückgängig“ (Tag entfernen, Vorschlag übernehmen).
- Wer bei einem offenen Löschantrag allein arbeitet (kein weiteres Konto als Inhaber oder Steuerberatung), sieht zusätzlich zu
  „Eine zweite Person bestätigt“ einen Satz mit Link zu „Zugänge“, wo sich z. B. die Steuerberatung einladen lässt; stammt der Antrag von einem anderen Akteur, darf er selbst bestätigen und sieht den Satz nicht. Das Vier-Augen-Prinzip bleibt bewusst so.

### Meldung in drei Teilen

Jede Meldung beantwortet: **Was ist passiert?** · **Ist etwas verloren?** · **Was kannst du tun?** (mit Knopf,
z. B. „Erneut versuchen“). Den Rohtext des Servers gibt es eingeklappt unter „Details“, nie allein.

> Der Server antwortet gerade nicht. Deine Dokumente sind nicht verloren. [Erneut versuchen]

- Vorschlag: Eingebettet ist sie ein Hinweis-Kasten mit dem Symbol der Art; der Titel steht bei Fehler in `--danger`,
  bei Warnung in `--warn`, bei Erfolg und Info nur im Symbol.
- Fehler an einem Feld: siehe Felder.
- Erfolg: ein Satz in `role="status"`; er bleibt stehen (kein Toast, WCAG 2.2.1) und verschwindet nach weiteren Änderungen.
- Der Router hat `defaultNotFoundComponent` und `defaultErrorComponent` (`src/components/Fehlerseiten.tsx`, Baustein
  `Meldung.tsx`); eine unbekannte Adresse zeigt die Meldung in der Shell. Schlägt `/api/ich` anders als mit 401
  fehl, zeigt die Shell „Der Server antwortet gerade nicht“ mit „Erneut versuchen“ statt „Lädt …“.

### Leerzustand

Ein Satz und **genau ein** Knopf zur nächsten Handlung: „Noch keine Dokumente. [Dokument hochladen]“, „Noch kein
Postfach. [Postfach verbinden]“. „Keine Treffer für „Rechnung“. [Filter zurücksetzen]“ ist etwas anderes als „Noch keine
Dokumente“ und darf nie wie ein leeres Archiv aussehen. Umgesetzt für Archiv und Eingang (`DocumentList.tsx`); die
übrigen Leerzustände („Noch keine Tags“, „Noch keine Postfächer“ …) haben noch keinen Knopf. Gestaltung siehe Behälter.

### Einmalwert

Für Token, Webhook-Geheimnis, Einladungslink und Freigabelink, die nur einmal erscheinen: `Einmalwert.tsx`. Der Wert steht in
`font-mono` mit `overflow-wrap: anywhere` und ist mit einem Klick ganz auswählbar (`select-all`); er steht in einem
Hinweis-Kasten (Vorschlag, heute Rand und Fläche). Darunter steht der Knopf
„Kopieren“ (40 px, auf `pointer-coarse` 44 px, Schrift 16 px auf dem Handy, sichtbarer Fokusring in `--fg`). Die Rückmeldung
„Kopiert.“ steht in einer eigenen Live-Region (`role="status"`, nicht um den Wert selbst: sonst liest ein Screenreader das
Geheimnis vor). Fehlt die Zwischenablage oder wird sie abgelehnt, sagt dieselbe Region „Kopieren nicht möglich, bitte den Wert
markieren.“ Darunter in normaler Größe: „Wird nur jetzt angezeigt.“ Der Wert ist per Tastatur erreichbar (`tabindex="0"`, Fokusring), und der Fokus markiert ihn ganz. Die Rückmeldung hat festen Platz (den der längsten Meldung, unsichtbar in derselben Zelle), damit beim Klick nichts springt. Der Wert steht in keinem Attribut, keiner URL und keinem Log.
Nicht darunter: Backup-Codes (eigene Liste mit Download) und der TOTP-Schlüssel (steht bis zur Bestätigung im Dialog).

### „Was ist das?“

Ein kleiner Knopf neben dem Fachbegriff (ASN, Siegel, Hash-Kette, Sperre, Art) klappt darunter einen Satz in einfacher
Sprache auf (`<details>` oder `aria-expanded`), mit Link „Mehr im Glossar“. Umgesetzt in `src/components/WasIstDas.tsx` (`Explain`) für ASN, Siegel, Hash-Kette, Sperre und Art, je an einer Stelle:
Dokumentseite, Startseite, Fristen, Einordnung. Der Knopf hat 40 px (44 px bei Touch); der Satz darf die Zeilen darunter
schieben. Vorschlag: Der Knopf zeigt Lucide `circle-question-mark` in `--muted` (heute ein `?` im Kreis), der Satz steht in
Lesen (heute 16 px nur nach Breite). In Zweispaltenlisten steht der Knopf in der Wertzelle, damit die Begriffsspalte nicht breiter wird. Das Glossar ist `docs/glossar.md`; der Link zeigt wie die anderen Doku-Links auf die
veröffentlichte Seite, mit einem Anker je Begriff.
Kein Hover, kein Popover: Beides erreicht weder Tastatur noch Touch zuverlässig.

### Fristvorschau, Tooltip, Pagination, Fortschritt (Vorschlag)

- **Fristvorschau:** **ein** Hinweis-Kasten mit einer Definitionsliste und `aria-live="polite"`, nicht mehrere Kästen.
- **Tooltip** nur für Nur-Symbol-Knöpfe, als Wiederholung des `aria-label`, mittig über dem Knopf, nach 500 ms, nur
  Deckkraft. Touch zeigt ihn nie, darum trägt er nie eine Erklärung.
- **Pagination:** „Vorherige Seite“ und „Nächste Seite“ (Verb mit Objekt), dazu die Anzeige „… Seite 1 von 39“.
- **Fortschritt:** der Satz „Schritt 2 von 5: …“ plus fünf Segmente; der Text trägt die Aussage.

## Texte

Texte stehen in `messages/de.json` und `messages/en.json` (Paraglide), nie im Code. Ton: ruhig, du-Form, kurze Sätze,
Fachwort erst mit Erklärung. Wörter haben **eine** Bedeutung; die heutigen Schlüssel sind uneinheitlich und werden mit
dem Glossar angeglichen:

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

- Springt der Fokus nach dem Seitenwechsel auf die Überschrift?
- Ob eine Einstellung „größere Schrift“ oder „ruhige Ansicht“ unter „Konto“ gewünscht ist.
- Verben der Tabelle oben: Stimmt die Zuordnung, bevor `de.json` und `en.json` angeglichen werden?
- Ob die Knopfart „Gefahr“ eine Komponente wird oder nur Klassen bleibt.
