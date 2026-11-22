import { describe, expect, it } from "vitest";
import { m } from "./paraglide/messages.js";

/*
 * Texte mit einer Zahl davor: bei 1 die Einzahl, sonst die Mehrzahl, in beiden Sprachen (Paraglide, Variante „plural“
 * in messages/*.json). Die Zahlen kommen als Text, wie die Oberfläche sie übergibt.
 */
type Fall = [string, (n: string, locale: "de" | "en") => string, string, string, string, string];

const FAELLE: Fall[] = [
  [
    "templates_months",
    (n, locale) => m.templates_months({ monate: n }, { locale }),
    "1 Monat ab Entstehung",
    "2 Monate ab Entstehung",
    "1 month from creation",
    "2 months from creation",
  ],
  [
    "bulk_selected",
    (n, locale) => m.bulk_selected({ anzahl: n }, { locale }),
    "1 Dokument ausgewählt",
    "2 Dokumente ausgewählt",
    "1 document selected",
    "2 documents selected",
  ],
  [
    "drop_done",
    (n, locale) => m.drop_done({ anzahl: n }, { locale }),
    "1 Dokument aufgenommen",
    "2 Dokumente aufgenommen",
    "1 document received",
    "2 documents received",
  ],
  [
    "drop_duplicates",
    (n, locale) => m.drop_duplicates({ anzahl: n }, { locale }),
    "1 Datei lag schon im Archiv und wurde nicht doppelt angelegt.",
    "2 Dateien lagen schon im Archiv und wurden nicht doppelt angelegt.",
    "1 file was already in the archive and was not added twice.",
    "2 files were already in the archive and were not added twice.",
  ],
  [
    "order_count",
    (n, locale) => m.order_count({ anzahl: n }, { locale }),
    "1 Dokument",
    "2 Dokumente",
    "1 document",
    "2 documents",
  ],
  ["period_years", (n, locale) => m.period_years({ years: n }, { locale }), "1 Jahr", "2 Jahre", "1 year", "2 years"],
  [
    "audit_problems",
    (n, locale) => m.audit_problems({ anzahl: n }, { locale }),
    "1 Befund",
    "2 Befunde",
    "1 finding",
    "2 findings",
  ],
  [
    "start_chain_findings",
    (n, locale) => m.start_chain_findings({ anzahl: n }, { locale }),
    "1 Befund",
    "2 Befunde",
    "1 finding",
    "2 findings",
  ],
  [
    "audit_files_checked",
    (n, locale) => m.audit_files_checked({ anzahl: n }, { locale }),
    "1 Datei gegen ihren Hash geprüft.",
    "2 Dateien gegen ihren Hash geprüft.",
    "1 file checked against its hash.",
    "2 files checked against their hash.",
  ],
  [
    "einvoice_check_invalid",
    (n, locale) => m.einvoice_check_invalid({ anzahl: n }, { locale }),
    "Ungültig: 1 Fehler",
    "Ungültig: 2 Fehler",
    "Invalid: 1 error",
    "Invalid: 2 errors",
  ],
  [
    "einvoice_check_warnings",
    (n, locale) => m.einvoice_check_warnings({ anzahl: n }, { locale }),
    "1 Warnung",
    "2 Warnungen",
    "1 warning",
    "2 warnings",
  ],
  [
    "doc_text_file",
    (n, locale) => m.doc_text_file({ anzahl: n }, { locale }),
    "1 Zeichen aus der Datei",
    "2 Zeichen aus der Datei",
    "1 character from the file",
    "2 characters from the file",
  ],
  [
    "doc_text_ocr",
    (n, locale) => m.doc_text_ocr({ anzahl: n }, { locale }),
    "1 Zeichen aus der Texterkennung",
    "2 Zeichen aus der Texterkennung",
    "1 character from text recognition",
    "2 characters from text recognition",
  ],
  [
    "report_counts",
    // Drei Zahlen in einem Satz: je Zahl ein Text, report_counts setzt sie zusammen (src/pages/AuditPage.tsx)
    (n, locale) =>
      m.report_counts(
        {
          dokumente: m.report_documents({ dokumente: n, geloescht: "0" }, { locale }),
          siegel: m.report_seals({ siegel: n }, { locale }),
          protokoll: m.report_entries({ protokoll: n }, { locale }),
        },
        { locale },
      ),
    "1 Dokument (davon 0 gelöscht), 1 Siegel, 1 Eintrag im Protokoll.",
    "2 Dokumente (davon 0 gelöscht), 2 Siegel, 2 Einträge im Protokoll.",
    "1 document (0 deleted), 1 seal, 1 log entry.",
    "2 documents (0 deleted), 2 seals, 2 log entries.",
  ],
  [
    "order_tag_excluded_warning",
    (n, locale) => m.order_tag_excluded_warning({ anzahl: n }, { locale }),
    "Ausgeschlossen bei 1 Mitarbeiter oder 1 Einladung: Ohne den Tag sieht dieser Zugang seine Dokumente.",
    "Ausgeschlossen bei 2 Mitarbeitern oder Einladungen: Ohne den Tag sehen sie seine Dokumente.",
    "Excluded for 1 staff member or invitation: without the tag they will see its documents.",
    "Excluded for 2 staff members or invitations: without the tag they will see its documents.",
  ],
  [
    "bulk_done",
    (n, locale) => m.bulk_done({ anzahl: n, eingeordnet: "0" }, { locale }),
    "1 Dokument geändert, davon 0 eingeordnet.",
    "2 Dokumente geändert, davon 0 eingeordnet.",
    "1 document changed, 0 of them classified.",
    "2 documents changed, 0 of them classified.",
  ],
  [
    "share_done",
    (n, locale) => m.share_done({ anzahl: n }, { locale }),
    "Im Eingang: 1 Datei.",
    "Im Eingang: 2 Dateien.",
    "In the inbox: 1 file.",
    "In the inbox: 2 files.",
  ],
  [
    "share_link_fetched",
    (n, locale) => m.share_link_fetched({ anzahl: n, zeit: "heute" }, { locale }),
    "1-mal abgerufen, zuletzt heute",
    "2-mal abgerufen, zuletzt heute",
    "Downloaded 1 time, last heute",
    "Downloaded 2 times, last heute",
  ],
  [
    "merge_button",
    (n, locale) => m.merge_button({ anzahl: n }, { locale }),
    "1 PDF zusammenfügen",
    "2 PDFs zusammenfügen",
    "Merge 1 PDF",
    "Merge 2 PDFs",
  ],
  [
    "paperless_progress",
    (n, locale) => m.paperless_progress({ uebernommen: n, gesamt: n, fehler: n }, { locale }),
    "1 von 1 übernommen, 1 Fehler",
    "2 von 2 übernommen, 2 Fehler",
    "1 of 1 taken over, 1 error",
    "2 of 2 taken over, 2 errors",
  ],
  [
    "paperless_progress_open",
    (n, locale) => m.paperless_progress_open({ uebernommen: n, fehler: n }, { locale }),
    "1 übernommen, 1 Fehler",
    "2 übernommen, 2 Fehler",
    "1 taken over, 1 error",
    "2 taken over, 2 errors",
  ],
  [
    "start_paperless_run",
    (n, locale) => m.start_paperless_run({ status: "fertig", uebernommen: n, fehler: n, zeit: "heute" }, { locale }),
    "fertig: 1 übernommen, 1 Fehler, heute",
    "fertig: 2 übernommen, 2 Fehler, heute",
    "fertig: 1 taken over, 1 error, heute",
    "fertig: 2 taken over, 2 errors, heute",
  ],
  [
    "start_holds_hint",
    (n, locale) => m.start_holds_hint({ anzahl: n }, { locale }),
    "1 Dokument darunter",
    "2 Dokumente darunter",
    "1 document covered",
    "2 documents covered",
  ],
  [
    "start_storage_hint",
    (n, locale) => m.start_storage_hint({ anzahl: n }, { locale }),
    "1 Datei, ohne gelöschte",
    "2 Dateien, ohne gelöschte",
    "1 file, without deleted ones",
    "2 files, without deleted ones",
  ],
  [
    "suggest_learned_reason",
    (n, locale) => m.suggest_learned_reason({ anzahl: n }, { locale }),
    "(wie 1 Dokument)",
    "(wie 2 Dokumente)",
    "(like 1 document)",
    "(like 2 documents)",
  ],
  [
    "suggest_learned_reason_words",
    (n, locale) => m.suggest_learned_reason_words({ anzahl: n, woerter: "a" }, { locale }),
    "(wie 1 Dokument; Wörter: a)",
    "(wie 2 Dokumente; Wörter: a)",
    "(like 1 document; words: a)",
    "(like 2 documents; words: a)",
  ],
  [
    "forward_tries",
    (n, locale) => m.forward_tries({ anzahl: n }, { locale }),
    "1 Versuch",
    "2 Versuche",
    "1 attempt",
    "2 attempts",
  ],
  [
    "start_chain_checked_value",
    (n, locale) => m.start_chain_checked_value({ zeit: "heute", eintraege: n }, { locale }),
    "heute, 1 Eintrag",
    "heute, 2 Einträge",
    "heute, 1 entry",
    "heute, 2 entries",
  ],
];

describe("Einzahl und Mehrzahl", () => {
  it.each(FAELLE)("%s", (_, text, de1, de2, en1, en2) => {
    expect([text("1", "de"), text("2", "de"), text("1", "en"), text("2", "en")]).toEqual([de1, de2, en1, en2]);
  });

  it("start_view_count: das Wort neben der großen Zahl der Kachel", () => {
    expect(
      ["1", "2"].flatMap((n) => [
        m.start_view_count({ anzahl: n }, { locale: "de" }),
        m.start_view_count({ anzahl: n }, { locale: "en" }),
      ]),
    ).toEqual(["Dokument", "document", "Dokumente", "documents"]);
  });
});
