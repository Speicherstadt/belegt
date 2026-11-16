import type { Sortierung } from "../../shared/archivansicht.ts";
import { ApiFehler, antwort, aufruf, json } from "./api-aufruf.ts";
import type { Ordnung, OrdnungsVorschlag, TagKurz } from "./api-ordnung.ts";

/* Dokumente: Liste, Aufnahme, Einordnung, Löschung, Mails, Vorschläge, Verlauf und Links (docs/api.md) */

export type Art = "buecher" | "zoll" | "beleg" | "geschaeftsbrief" | "sonstige" | "freiwillig" | "frei";
export type Gruppe =
  | "alle"
  | "offen"
  | "pflicht"
  | "freiwillig"
  | "frei"
  | "loeschbar"
  | "geloescht"
  | "erechnung_ungueltig";

export interface Dokument {
  id: string;
  /** Archivnummer, fortlaufend in der Reihenfolge des Eingangs */
  asn: number;
  sha256: string;
  groesse: number;
  mimeType: string;
  dateiname: string | null;
  quelle: string;
  eingegangenAm: string;
}

/** Eine Datei, die schon im Archiv lag; id und asn null, wenn der Zugang das vorhandene Dokument nicht sieht */
export interface Doppelt {
  dateiname: string;
  id: string | null;
  asn: number | null;
}

export type Hochgeladen = { dokument: Dokument; doppelt?: undefined } | { dokument?: undefined; doppelt: Doppelt };

export interface Eintrag extends Dokument {
  art: Art | null;
  fristBis: string | null;
  titel: string | null;
  tags: TagKurz[];
  dokumenttyp: { id: string; name: string } | null;
  korrespondent: { id: string; name: string } | null;
  /** Ob es ein Vorschaubild der ersten Seite gibt */
  vorschaubild: boolean;
}

/** Wie sicher ein gelernter Vorschlag ist und woraus er gelernt ist */
export interface Erklaerung {
  sicherheit: number;
  anzahl: number;
  woerter: string[];
}

export interface GelernterVorschlag {
  art: ({ wert: Art } & Erklaerung) | null;
  korrespondent: ({ id: string; name: string } & Erklaerung) | null;
  dokumenttyp: ({ id: string; name: string } & Erklaerung) | null;
  tags: (TagKurz & Erklaerung)[];
}

export interface Einordnung {
  id: string;
  art: Art;
  entstanden: string;
  fristBis: string | null;
  titel: string | null;
  korrespondent: string | null;
  erstelltAm: string;
}

export interface Loeschung {
  id: string;
  dokumentId: string;
  beantragtVon: string;
  beantragtAm: string;
  bestaetigtVon: string | null;
  bestaetigtAm: string | null;
  dateiname?: string | null;
}

export interface MailAnsicht {
  messageId: string | null;
  von: string | null;
  an: string[];
  betreff: string;
  gesendetAm: string | null;
  text: string;
  /** vorhanden: lag schon als Dokument im Archiv, als die Mail kam */
  anhaenge: {
    dokumentId: string;
    dateiname: string | null;
    mimeType: string;
    eingebettet: boolean;
    vorhanden: boolean;
  }[];
  unterhaltung: { dokumentId: string; betreff: string; von: string | null; gesendetAm: string | null }[];
  ausMail: string | null;
}

export interface Ereignis {
  seq: number;
  at: string;
  akteur: string | null;
  aktion: string;
  tabelle: string;
  detail: string | null;
  /** Nur bei Ableitungen: aus einer Quelle abgeleitet oder ein neues Dokument daraus */
  richtung?: "aus" | "daraus";
}

export type SeitenOperation =
  | { operation: "drehen"; drehungen: { seite: number; grad: 90 | 180 | 270 }[] }
  | { operation: "entfernen"; seiten: number[] }
  | { operation: "teilen"; nach: number };
export type Ableitungsart = SeitenOperation["operation"] | "zusammenfuegen";

export interface Notiz {
  id: string;
  text: string;
  erstelltVon: string;
  erstelltAm: string;
}

/** Ein anderes Dokument, aus dem dieses abgeleitet ist oder das daraus abgeleitet wurde */
export interface Verknuepfung {
  dokumentId: string;
  dateiname: string | null;
  titel: string | null;
  asn: number;
  operation: Ableitungsart;
  parameter: Record<string, unknown>;
  position: number;
  akteur: string;
  erstelltAm: string;
  geloescht: boolean;
}

export interface ERechnung {
  syntax: "cii" | "ubl";
  nummer: string | null;
  datum: string | null;
  typ: string | null;
  verkaeufer: string | null;
  kaeufer: string | null;
  bruttoCent: number | null;
  waehrung: string | null;
}

/** Ergebnis des KoSIT-Validators für eine E-Rechnung */
export interface ERechnungsPruefung {
  gueltig: boolean;
  szenario: string | null;
  fehler: number;
  warnungen: number;
  meldungen: { stufe: "fehler" | "warnung"; code: string | null; text: string }[];
  geprueftAm: string;
}

/** Ein gültiger geteilter Link (docs/teilen.md); den Link selbst gibt es nur beim Anlegen */
export interface GeteilterLink {
  id: string;
  erstelltVon: string;
  erstelltAm: string;
  gueltigBis: string;
  abrufe: number;
  letzterAbruf: string | null;
}

/** Einträge je Seite in Archiv und Eingang */
export const PRO_SEITE = 50;

export const dokumenteApi = {
  /** Eine Seite der Liste (ab 1) und die Zahl aller Treffer aus X-Gesamt */
  dokumente: async (
    suche: string,
    gruppe: Gruppe = "alle",
    filter = "",
    seite = 1,
    proSeite = PRO_SEITE,
    sortierung: Sortierung = "neu",
  ) => {
    const res = await antwort(
      `/api/dokumente?suche=${encodeURIComponent(suche)}&gruppe=${gruppe}&seite=${seite}&proSeite=${proSeite}&sortierung=${sortierung}${filter}`,
    );
    const eintraege = (await res.json()) as Eintrag[];
    return { eintraege, gesamt: Number(res.headers.get("x-gesamt") ?? eintraege.length) };
  },
  dokument: (id: string) =>
    aufruf<
      Dokument &
        Ordnung & {
          einordnung: Einordnung | null;
          loeschung: Loeschung | null;
          ansicht: boolean;
          archivfassung: boolean;
        }
    >(`/api/dokumente/${id}`),
  /** Liegt dieselbe Datei schon im Archiv, legt der Server nichts an (409); dann das vorhandene Dokument */
  hochladen: async (datei: File): Promise<Hochgeladen> => {
    const form = new FormData();
    form.append("datei", datei);
    try {
      return { dokument: await aufruf<Dokument>("/api/dokumente", { method: "POST", body: form }) };
    } catch (err) {
      if (err instanceof ApiFehler && err.status === 409 && err.vorhanden)
        return { doppelt: { dateiname: datei.name, ...err.vorhanden } };
      throw err;
    }
  },
  verlauf: (id: string) => aufruf<{ ereignisse: Ereignis[]; siegel: string | null }>(`/api/dokumente/${id}/verlauf`),
  inhalt: (id: string) =>
    aufruf<{
      erechnung: ERechnung | null;
      fehler: string | null;
      ocr: boolean;
      textLaenge: number;
      pruefung: ERechnungsPruefung | null;
    } | null>(`/api/dokumente/${id}/inhalt`),
  einordnen: (
    id: string,
    eingabe: { art: Art; entstanden: string; freiwilligBis?: string; titel?: string; korrespondent?: string },
  ) => aufruf<Einordnung>(`/api/dokumente/${id}/einordnung`, json(eingabe)),
  loeschungBeantragen: (id: string) => aufruf<Loeschung>(`/api/dokumente/${id}/loeschung`, { method: "POST" }),
  loeschungen: () => aufruf<Loeschung[]>("/api/loeschungen"),
  loeschungBestaetigen: (id: string) => aufruf<Loeschung>(`/api/loeschungen/${id}/bestaetigen`, { method: "POST" }),
  loeschungZurueckziehen: (id: string) => aufruf<unknown>(`/api/loeschungen/${id}`, { method: "DELETE" }),
  mailsImportieren: (datei: File) => {
    const form = new FormData();
    form.append("datei", datei);
    return aufruf<{ neu: string[]; doppelt: string[] }>("/api/mails", { method: "POST", body: form });
  },
  mail: async (id: string): Promise<MailAnsicht | null> => {
    try {
      return await aufruf<MailAnsicht>(`/api/dokumente/${id}/mail`);
    } catch (err) {
      if (err instanceof ApiFehler && err.status === 404) return null;
      throw err;
    }
  },
  vorschlag: (id: string) =>
    aufruf<{
      vorschlag: { art: Art | null; regel: { id: string; name: string }; ordnung: OrdnungsVorschlag | null } | null;
      /** Aus den Zuordnungsregeln an Korrespondenten, Dokumenttypen und Tags */
      zuordnung: (OrdnungsVorschlag & { uebersprungen: string[] }) | null;
      /** Aus den eigenen Einordnungen gelernt; ohne, was Regel und Zuordnungsregel schon vorschlagen */
      gelernt: GelernterVorschlag | null;
      erechnung: ERechnung | null;
      ki: {
        art: Art;
        entstanden: string | null;
        titel: string | null;
        korrespondent: string | null;
        begruendung: string;
        modell: string;
        ordnung: OrdnungsVorschlag | null;
      } | null;
      /** Titel, Korrespondent und Entstehung aus einem Import (Paperless-ngx) */
      import: {
        titel: string | null;
        korrespondent: string | null;
        entstanden: string | null;
        herkunft: string;
      } | null;
    }>(`/api/dokumente/${id}/vorschlag`),
  links: (id: string) => aufruf<GeteilterLink[]>(`/api/dokumente/${id}/links`),
  linkAnlegen: (id: string, tage: 1 | 7 | 30) =>
    aufruf<{ id: string; url: string; gueltigBis: string }>(`/api/dokumente/${id}/links`, json({ tage })),
  linkWiderrufen: (id: string, link: string) =>
    aufruf<{ ok: true }>(`/api/dokumente/${id}/links/${link}/widerrufen`, { method: "POST" }),
  seiten: (id: string) => aufruf<{ anzahl: number }>(`/api/dokumente/${id}/seiten`),
  seitenBearbeiten: (id: string, op: SeitenOperation) =>
    aufruf<{ dokumente: Dokument[] }>(`/api/dokumente/${id}/seiten`, json(op)),
  zusammenfuegen: (ids: string[]) => aufruf<Dokument>("/api/dokumente/zusammenfuegen", json({ ids })),
  ableitungen: (id: string) =>
    aufruf<{ aus: Verknuepfung[]; daraus: Verknuepfung[] }>(`/api/dokumente/${id}/ableitungen`),
  aehnliche: (id: string) =>
    aufruf<
      {
        id: string;
        asn: number;
        dateiname: string | null;
        titel: string | null;
        mimeType: string;
        vorschaubild: boolean;
      }[]
    >(`/api/dokumente/${id}/aehnliche`),
  notizen: (id: string) => aufruf<Notiz[]>(`/api/dokumente/${id}/notizen`),
  notizAnlegen: (id: string, text: string) => aufruf<Notiz>(`/api/dokumente/${id}/notizen`, json({ text })),
  notizZurueckziehen: (id: string, notiz: string) =>
    aufruf<{ ok: true }>(`/api/dokumente/${id}/notizen/${notiz}/zurueckziehen`, { method: "POST" }),
  freigabe: (id: string) =>
    aufruf<{ url: string; gueltigBis: string }>(`/api/dokumente/${id}/freigabe`, { method: "POST" }),
};

export const exportUrl = (von: string, bis: string) =>
  `/api/export?von=${encodeURIComponent(von)}&bis=${encodeURIComponent(bis)}`;

/** Mehrere Originale als ZIP (GET /api/dokumente/zip) */
export const zipUrl = (ids: string[]) => `/api/dokumente/zip?ids=${ids.join(",")}`;

export const trennblattUrl = "/api/trennblatt.pdf";
export const seiteUrl = (id: string, nr: number) => `/api/dokumente/${id}/seiten/${nr}`;
export const vorschaubildUrl = (id: string) => `/api/dokumente/${id}/vorschaubild`;
export const ansichtUrl = (id: string) => `/api/dokumente/${id}/ansicht`;
export const archivfassungUrl = (id: string) => `/api/dokumente/${id}/archivfassung`;
export const dateiUrl = (id: string, ansicht = false) => `/api/dokumente/${id}/datei${ansicht ? "?ansicht=1" : ""}`;
