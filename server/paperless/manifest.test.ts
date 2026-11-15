import { describe, expect, it } from "vitest";
import { istManifest, manifestLesen } from "./manifest.ts";

/* Selbst geschriebene Manifeste im Format des document_exporter, keine echten Daten */

const basis = [
  { model: "auth.user", pk: 3, fields: { username: "anna", password: "pbkdf2_sha256$geheim" } },
  { model: "paperless_mail.mailaccount", pk: 1, fields: { password: "postfach-geheim" } },
  { model: "documents.correspondent", pk: 1, fields: { name: "Stadtwerke" } },
  { model: "documents.documenttype", pk: 2, fields: { name: "Rechnung" } },
  { model: "documents.tag", pk: 5, fields: { name: "Strom", color: "#a6cee3" } },
  { model: "documents.tag", pk: 6, fields: { name: "2026" } },
  {
    model: "documents.customfield",
    pk: 10,
    fields: { name: "Betrag", data_type: "monetary", extra_data: { default_currency: "EUR" } },
  },
  {
    model: "documents.customfield",
    pk: 11,
    fields: { name: "Status", data_type: "select", extra_data: { select_options: [{ id: "o1", label: "Offen" }] } },
  },
  {
    model: "documents.customfield",
    pk: 12,
    fields: { name: "Alt", data_type: "select", extra_data: { select_options: ["Ja", "Nein"] } },
  },
];

const dokument = (pk: number, fields: Record<string, unknown>, datei: string | null = `originals/${pk}.pdf`) => ({
  model: "documents.document",
  pk,
  fields: {
    title: `Dokument ${pk}`,
    correspondent: null,
    document_type: null,
    tags: [],
    created: "2026-01-15",
    archive_serial_number: null,
    original_filename: `${pk}.pdf`,
    checksum: "0".repeat(64),
    deleted_at: null,
    root_document: null,
    version_index: null,
    content: "langer OCR-Text",
    ...fields,
  },
  ...(datei ? { __exported_file_name__: datei } : {}),
});

describe("manifest.json", () => {
  it("liest Dokumente mit Namen statt IDs, Feldwerten und Notizen", () => {
    const exp = manifestLesen([
      [
        ...basis,
        dokument(1, {
          correspondent: 1,
          document_type: 2,
          tags: [5, 6, 99],
          archive_serial_number: 17,
          checksum: "a".repeat(32),
        }),
        {
          model: "documents.note",
          pk: 1,
          fields: { document: 1, note: "Bezahlt am 3.2.", user: 3, created: "2026-02-03T09:00:00Z", deleted_at: null },
        },
        {
          model: "documents.note",
          pk: 2,
          fields: { document: 1, note: "gelöscht", user: 3, deleted_at: "2026-02-04T00:00:00Z" },
        },
        {
          model: "documents.customfieldinstance",
          pk: 1,
          fields: { document: 1, field: 10, value_monetary: "EUR89.90", value_text: null },
        },
        { model: "documents.customfieldinstance", pk: 2, fields: { document: 1, field: 11, value_select: "o1" } },
      ],
    ]);
    expect(exp.felder.map((f) => [f.name, f.typ])).toEqual([
      ["Betrag", "monetary"],
      ["Status", "select"],
      ["Alt", "select"],
    ]);
    expect(exp.felder[0]!.waehrung).toBe("EUR");
    expect(exp.felder[2]!.optionen).toEqual([
      { id: "0", label: "Ja" },
      { id: "1", label: "Nein" },
    ]);
    expect(exp.dokumente).toEqual([
      {
        id: 1,
        titel: "Dokument 1",
        korrespondent: "Stadtwerke",
        dokumenttyp: "Rechnung",
        tags: ["Strom", "2026"],
        created: "2026-01-15",
        asn: 17,
        dateiname: "1.pdf",
        pruefsumme: "a".repeat(32),
        notizen: [{ text: "Bezahlt am 3.2.", autor: "anna", erstellt: "2026-02-03T09:00:00Z" }],
        felder: [
          { feldId: 10, wert: "EUR89.90" },
          { feldId: 11, wert: "o1" },
        ],
        datei: "originals/1.pdf",
      },
    ]);
    // Passwörter und Postfächer liest Belegt nicht
    expect(JSON.stringify(exp)).not.toContain("geheim");
  });

  it("lässt den Papierkorb aus und nimmt von Versionen die neueste", () => {
    const exp = manifestLesen([
      [
        dokument(1, {}),
        dokument(2, { deleted_at: "2026-03-01T00:00:00Z" }),
        dokument(
          3,
          { root_document: 1, version_index: 1, checksum: "b".repeat(64), original_filename: "v2.pdf" },
          "originals/v2.pdf",
        ),
        dokument(4, {
          root_document: 1,
          version_index: 2,
          checksum: "c".repeat(64),
          original_filename: "v3.pdf",
          deleted_at: "x",
        }),
      ],
    ]);
    expect(exp.papierkorb).toBe(1);
    expect(exp.dokumente).toHaveLength(1);
    expect(exp.dokumente[0]).toMatchObject({
      id: 1,
      titel: "Dokument 1",
      pruefsumme: "b".repeat(64),
      datei: "originals/v2.pdf",
      dateiname: "v2.pdf",
    });
  });

  it("führt mit --split-manifest die Dateien je Dokument zusammen", () => {
    const exp = manifestLesen([
      basis,
      [
        dokument(7, { tags: [5] }, "7.pdf"),
        { model: "documents.note", pk: 9, fields: { document: 7, note: "Aus der eigenen Datei", user: null } },
      ],
    ]);
    expect(exp.dokumente[0]).toMatchObject({
      id: 7,
      tags: ["Strom"],
      notizen: [{ text: "Aus der eigenen Datei", autor: null }],
    });
    expect(istManifest("manifest.json")).toBe(true);
    expect(istManifest("json/7-manifest.json")).toBe(true);
    expect(istManifest("originals/manifest.json.pdf")).toBe(false);
  });

  it("kennt ein Dokument ohne Datei (Export mit --data-only) und lehnt anderes als eine Liste ab", () => {
    expect(manifestLesen([[dokument(1, {}, null)]]).dokumente[0]!.datei).toBeNull();
    expect(() => manifestLesen([{ model: "documents.document" }])).toThrow("keine Liste");
    // Kaputte Einträge überspringt es
    expect(manifestLesen([[null, 5, { model: "documents.document", pk: "x", fields: {} }]]).dokumente).toEqual([]);
  });
});
