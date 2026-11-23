---
title: "Korrespondenten, Tags, Dokumenttypen und eigene Felder"
description: >-
  Das Archiv in Belegt ordnen: Korrespondenten, Tags, Dokumenttypen und eigene Felder neben der Art, die die Frist bestimmt, mit Zuordnungsregeln, gelernten Vorschlägen, Filter, Suche und Verlauf.
---

# Ordnung

Neben der Art, die die Frist bestimmt ([Fristen](fristen.md)), ordnest du Dokumente mit Korrespondenten, Tags,
Dokumenttypen und eigenen Feldern. Das sind Metadaten, nicht das Original: Sie lassen sich ändern, aber jede Änderung steht mit Person und
Zeitpunkt im Audit-Log und im Verlauf des Dokuments. Anlegen darf nur der Inhaber, zuweisen auch
[Mitarbeiter](zugaenge.md#mitarbeiter) mit dem Recht „bearbeiten“ in ihrem Sichtbereich; Steuerberatung und Prüfer sehen sie. Verwaltet werden sie auf der Seite Ordnung.


Die Seite Ordnung hat vier Reiter: Korrespondenten, Tags, Dokumenttypen und eigene Felder. Der Reiter steht in der
Adresse (`?bereich=tags`), ein Feld filtert die Liste nach Namen.

## Korrespondenten

Ein Korrespondent ist, von wem ein Dokument kommt oder an wen es geht, etwa „Stadtwerke“; jedes Dokument hat höchstens
einen. Die Namen stehen in einer Liste, ohne Unterschied zwischen Groß- und Kleinschreibung eindeutig. Beim Einordnen
schlägt das Feld die vorhandenen Namen vor; ein neuer Name kommt in die Liste, „stadtwerke“ landet beim vorhandenen
„Stadtwerke“. Auf der Seite des Dokuments setzt oder entfernt ihn der Inhaber auch ohne neue Einordnung.

Die Einordnung ist versiegelt und hält den Namen fest, den der Korrespondent beim Einordnen hatte. Umbenennen ändert
nur die Liste: Archiv, Suche und Filter zeigen den neuen Namen, die Einordnung und der Verlauf („Eingeordnet
(Korrespondent: …)“) den alten. **Zusammenführen** macht aus zwei Schreibweisen eine: Die Dokumente, Regeln und
Workflows des einen bekommen den anderen, der eine verschwindet aus der Liste. Löschen geht nur, solange kein Dokument
im Archiv ihn hat; sonst führst du ihn zusammen. Gelöschte Dokumente stehen dem nicht im Weg, ihre Zuordnung entfernt
Belegt (wie beim Löschen eines Tags) und der Name bleibt in ihrer Einordnung. Bestehende Freitexte aus Einordnungen
vor dieser Liste hat Belegt beim Update als Einträge angelegt und zugeordnet, ohne die versiegelten Einordnungen zu
ändern.

Im Z3-Export steht beides: „Korrespondent“ aus der versiegelten Einordnung und „Korrespondent (Liste)“ mit dem heutigen
Namen ([Prüfung](pruefung.md#datenträger-für-die-betriebsprüfung-z3)); jede Umbenennung und Zuordnung steht im Protokoll.

## Tags

Ein Dokument hat beliebig viele Tags, etwa „Steuer 2026“ oder „Auto“. Ein Tag hat einen Namen (ohne Unterschied
zwischen Groß- und Kleinschreibung eindeutig) und eine Farbe aus einer festen Auswahl, deren Schrift auf dem
Hintergrund in hell und dunkel mindestens 4,5:1 Kontrast hat. Umbenennen geht jederzeit. Einen Tag zu löschen entfernt
nur seine Zuordnungen, jede einzeln im Audit-Log; die Dokumente bleiben.

## Dokumenttypen

Ein Dokumenttyp sagt, was ein Dokument ist, etwa „Vertrag“ oder „Kontoauszug“; jedes hat höchstens einen. Er ist
getrennt von der Art: Die Frist richtet sich allein nach der Art der Einordnung. Ein Dokumenttyp kann eine Vorgabe-Art
haben, die beim Einordnen vorgeschlagen wird, etwa „Kontoauszug“ → Buchungsbeleg. Übernommen wird sie erst, wenn du
einordnest.

## Eigene Felder

Eigene Felder halten Werte je Dokument, etwa eine Vertragsnummer oder eine Summe. Der Typ ist ab dem Anlegen fest:

| Typ | Wert |
| --- | --- |
| Text | bis 1000 Zeichen |
| Zahl | ganze Zahl |
| Betrag | Euro in ganzen Cent; Eingabe wie `1.234,56`, Anzeige mit Währung |
| Datum | Tag |
| Ja/Nein | ja oder nein |
| Auswahl | eine der festgelegten Optionen; eine Option, die ein Dokument nutzt, lässt sich nicht entfernen |
| Link | Adresse mit `http` oder `https` |

Belegt prüft jeden Wert auf dem Server. Ein leerer Wert entfernt ihn. Ein Feld zu löschen löscht seine Werte, jeden
einzeln im Audit-Log.

## Zuordnungsregeln

Jeder Korrespondent, Tag und Dokumenttyp kann eine Zuordnungsregel haben, wie in Paperless-ngx. Sie prüft, wenn ein
Dokument eingeht und sein Text gelesen ist, einmal Dateiname, Mailkopf und Text. Was passt, steht als Vorschlag auf
der Seite des Dokuments im Eingang; gesetzt wird nichts, bis du „Übernehmen“ klickst. Ändert sich eine Regel, prüft
Belegt die Dokumente im Eingang neu.

| Zuordnung | trifft, wenn der Text … |
| --- | --- |
| Keine | nie, auch nicht gelernt |
| Irgendein Wort | eines der Wörter als ganzes Wort enthält; Wörter in Anführungszeichen gelten zusammen |
| Alle Wörter | jedes der Wörter enthält, in beliebiger Reihenfolge |
| Exakt | genau diese Zeichenfolge als ganze Wörter enthält |
| Regulärer Ausdruck | auf den Ausdruck passt (JavaScript, Unicode); nach 0,1 Sekunden bricht Belegt ab, die Regel trifft dann nicht und der Vorschlag nennt sie |
| Unscharf | dem Text an einer Stelle zu mindestens 90 % gleicht, Satzzeichen nicht gezählt (Tippfehler, „Telekon“ statt „Telekom“); höchstens 100 Zeichen, geprüft in den ersten 10 000 Zeichen des Dokuments |
| Automatisch | Vorgabe: kein Text, Belegt lernt aus deinen Einordnungen (unten) |

„Groß- und Kleinschreibung ignorieren“ ist vorgegeben. Wortgrenzen und Groß- und Kleinschreibung gelten auch für
Umlaute. Von mehreren passenden Korrespondenten oder Dokumenttypen schlägt Belegt den ersten nach Namen vor, Tags alle,
die passen. Einen regulären Ausdruck, der sich nicht übersetzen lässt, nimmt Belegt nicht an.

## Gelernte Vorschläge

Aus den eingeordneten, nicht gelöschten Dokumenten lernt Belegt, welche Wörter zu welchem Korrespondenten, Dokumenttyp,
Tag und welcher Art gehören, ohne fremden Dienst (ein naiver Bayes-Klassifikator). Der Worker lernt neu, wenn sich
etwas getan hat, höchstens alle zehn Minuten. Ein Vorschlag kommt nur, wenn

- mindestens 10 Dokumente eingeordnet sind und der Korrespondent, Typ, Tag oder die Art mindestens 3 davon hat,
- der Korrespondent, Dokumenttyp oder Tag auf „Automatisch“ steht (die Art lernt Belegt immer) und
- Belegt sich zu mindestens 80 % sicher ist.

Jeder Vorschlag sagt, woraus er gelernt ist, etwa „Korrespondent Stadtwerke (wie 7 Dokumente; Wörter: abschlag, strom)“.
Die Art trägt „Übernehmen“ nur ins Formular; eingeordnet wird erst mit „Einordnen“.

Das Gelernte ist aus Inhalten abgeleitet und lässt sich jederzeit neu erzeugen. Deshalb steht es nicht im Audit-Log,
und mit jeder bestätigten Löschung verwirft Belegt es ganz und lernt danach ohne das gelöschte Dokument neu; Postgres
lehnt ein Modell ab, dessen Beispiele vor einer Löschung gelesen wurden. So bleibt von einem gelöschten Dokument nichts
im Gelernten (GoBD: keine Unterlage; DSGVO: keine Kopie über die Löschung hinaus).

## Vorschläge und Eingangsordner

[Regeln](eingang.md#regeln) schlagen neben der Art (oder ohne sie) Tags, einen Korrespondenten, einen Dokumenttyp und
Feldwerte vor, das [Sprachmodell](eingang.md#vorschläge-eines-sprachmodells) passende vorhandene Tags und einen
Dokumenttyp. „Übernehmen“ auf der Seite des Dokuments setzt sie. Die Reihenfolge der Vorschläge steht unter
[Eingang](eingang.md#vorschläge). Mit `EINGANG_ORDNER_TAGS=true` werden die Unterordner des
[Eingangsordners](eingang.md#eingangsordner) zu Tags.

## Direkt im Dokument anlegen

Fehlt ein Tag, Korrespondent oder Dokumenttyp, legt „+ Neu“ unter der Auswahl im Dokument ihn an und setzt ihn gleich;
die Seite Ordnung braucht es dafür nicht. Farbe und Zuordnungsregel lassen sich später dort ändern.

## Filter und Suche

Im Archiv filterst du nach Tags (der Knopf „Tags“ öffnet eine durchsuchbare Liste mit der Zahl der Dokumente je Tag; ein zweiter Klick schließt einen Tag aus, „Ohne Tag“ zeigt nur Dokumente ohne Tag; das Dokument hat alle gewählten oder, umgeschaltet, mindestens einen davon), nach
Korrespondent und Dokumenttyp (je ein Knopf mit durchsuchbarer Liste und der Zahl der Dokumente, auch „Ohne …“) und nach einem Feld: gesetzt, Text enthält, oder bei Betrag, Zahl und
Datum von–bis. Dazu kommt ein Zeitraum nach dem Tag der Entstehung oder des Eingangs: letzte 7 oder 30 Tage,
dieses oder letztes Jahr oder eigene Tage. Eine gespeicherte Ansicht mit „letzte 30 Tage“ meint immer die letzten 30
Tage, nicht die am Tag des Speicherns. Die Liste zeigt Korrespondent, Tags und Dokumenttyp unter dem Namen; ein Klick auf den Korrespondenten
zeigt alle seine Dokumente. Die Suche findet die Namen von Korrespondent, Tags und Dokumenttyp und die Werte der
Felder vom Typ Text, Auswahl und Link.

Sortiert wird nach Eingang (neueste oder älteste zuerst), Titel, Tag der Entstehung oder Fristende, über die Auswahl „Sortierung“ oder in der Liste per Klick auf die Spaltenköpfe Name, Aufbewahrung und Eingang (ein zweiter Klick auf Eingang kehrt die Reihenfolge um). Suche, Filter,
Sortierung, Liste oder Kacheln und die Zahl je Seite stehen in der Adresse des Archivs; so lässt sich jede Ansicht als
Link weitergeben oder als Lesezeichen ablegen.

## Gespeicherte Ansichten

„Ansicht speichern“ im Archiv legt die aktuelle Suche mit allen Filtern unter einem Namen ab. Sie steht dann in der
Seitenleiste unter Archiv; ein Klick setzt Suche und Filter wieder. Unter „Eigene Ansichten verwalten“ benennst du
Ansichten um, ordnest sie und löschst sie.

Ansichten gehören dem Zugang, der sie anlegt; jeder Zugang hat seine eigenen, auch Steuerberatung und Prüfer. Der
Inhaber kann eine Ansicht „für alle Zugänge“ speichern, dann sieht die Steuerberatung sie mit, der Prüfer nicht. Eine
Ansicht zeigt nie mehr, als der Zugang ohnehin sieht, beim Prüfer also nur seinen Zeitraum, beim Mitarbeiter seinen
Sichtbereich. Ansichten sind
Einstellungen, keine Unterlagen: Löschen geht jederzeit, jede Änderung steht im Audit-Log.

## Mehrfachauswahl

Eingang und Archiv zeigen 50 Dokumente je Seite (im Archiv auch 25 oder 100), darunter „1–50 von 312“ und die Knöpfe zum Blättern. Du wählst
Dokumente mit den Kästchen aus, mit dem Kästchen im Kopf der Tabelle alle auf der Seite; beim Blättern beginnt die
Auswahl neu. Sobald etwas gewählt ist, schwebt unten eine Leiste über der Liste: wie viele gewählt sind,
die Zahl, × zum Aufheben und die Aktionen (Tags, Korrespondent, Typ, Feld, Einordnen, bei PDFs Zusammenfügen, ZIP); Tags, Korrespondent und Typ wählst du in einer durchsuchbaren Liste über dem Knopf, ein Klick setzt sie sofort für alle (bei Tags: ✓ alle, – manche; ein neuer Name legt den Tag an); Feld, Einordnen und Zusammenfügen öffnen ein Formular darüber. Das Ergebnis steht danach an
derselben Stelle, bis du es schließt. Dann wendest du eine Aktion auf alle an: Tag hinzufügen oder entfernen, Korrespondent oder Dokumenttyp setzen, Feldwert setzen oder
einordnen. Einordnen geht wie bei einem einzelnen Dokument: Art, Tag der Entstehung (auf Wunsch der Tag des Eingangs
jedes Dokuments), Titel und Korrespondent. Ohne „Auch schon eingeordnete neu einordnen“ ordnet Belegt nur Dokumente im
Eingang ein und überspringt die übrigen; mit dem Häkchen kommt bei jedem eine neue Einordnung als Version dazu.

Eine Sammelbearbeitung ist eine Transaktion: Geht es bei einem Dokument nicht, etwa weil es gelöscht ist, ändert sich
bei keinem etwas, und Belegt nennt das Dokument und den Grund.

### Als ZIP herunterladen { #zip }

Jede Rolle kann wählen und die gewählten Dokumente mit „… als ZIP herunterladen“ in einer Datei laden. Darin liegen die
Originale unverändert unter lesbaren Namen: Archivnummer, Tag (Entstehung, sonst Eingang), Titel (sonst Dateiname)
und die Endung des Originals, etwa `ASN0042-2026-03-14-Rechnung Telekom.pdf`. Zeichen, die Dateisysteme nicht
erlauben, und unsichtbare Zeichen für die Schreibrichtung werden zu `_`, gleiche Namen bekommen „ (2)“. Gelöschte Dokumente und Originale, die fehlen oder nicht mehr
zu ihrem Hash passen, stehen statt der Datei in `nicht-enthalten.txt`. Ein Mitarbeiter oder Prüfer bekommt nur, was er
sieht. Höchstens eine Seite der Liste (200 Dokumente) und zusammen 2 GB; für einen ganzen Zeitraum ist der
[Z3-Export](pruefung.md) da. Wie beim einzelnen Original schreibt das Herunterladen nichts ins Audit-Log, das
Änderungen festhält, keine Zugriffe.

## Nach der Löschung

Korrespondent, Tags, Dokumenttyp und Feldwerte eines gelöschten Dokuments bleiben als Teil des Löschnachweises, neue
lehnt Postgres ab. Der aus der Datei gelesene Text verschwindet wie bisher mit der Löschung, auch aus der Suche.
