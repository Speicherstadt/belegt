import { eq, inArray, sql } from "drizzle-orm";
import { merkmalJoins, merkmalText, textFuer } from "../abgleich/merkmale.ts";
import type { Datenbank } from "../db/client.ts";
import { dokumenttypen, klassifikator, korrespondenten, tags } from "../db/schema.ts";
import { type Beispiel, lernen, type Modell, type Treffer, vorhersagen, woerterAus } from "./klassifikator.ts";

/*
 * Training und Vorschläge des Klassifikators (klassifikator.ts) mit der Datenbank. Gelernt wird im Worker aus den
 * eingeordneten, nicht gelöschten Dokumenten, sobald sich seit dem letzten Training etwas im Audit-Log getan hat. Das
 * Modell liegt in klassifikator: abgeleitet, jederzeit neu erzeugbar, nicht im Audit-Log, und mit jeder bestätigten
 * Löschung weg (belegt_inhalt_loeschen), damit die Wörter eines gelöschten Dokuments nicht im Modell bleiben.
 */

/** Höchstens so viele Beispiele, die neuesten zuerst */
const MAX_BEISPIELE = 5000;

/** Stand, aus dem gelernt wurde: der letzte Eintrag im Audit-Log (Einordnungen, Ordnung, Regeln, Löschungen) */
async function aktuellerStand(db: Datenbank): Promise<{ stand: string; loeschungen: number }> {
  const [z] = await db.execute<{ seq: string | null; loeschungen: string }>(sql`
    select (select max(seq) from audit_log)::text as seq,
           (select count(*) from loeschungen where bestaetigt_am is not null) as loeschungen`);
  return { stand: z?.seq ?? "0", loeschungen: Number(z?.loeschungen ?? 0) };
}

/** Eingeordnete, nicht gelöschte Dokumente mit Art und den Korrespondenten, Typen und Tags, die „automatisch“ lernen */
async function beispieleLaden(db: Datenbank): Promise<Beispiel[]> {
  const zeilen = await db.execute<{
    text: string;
    art: string;
    korrespondent: string | null;
    dokumenttyp: string | null;
    tags: string[];
  }>(sql`
    select ${merkmalText} as text, e.art,
           (select dk.korrespondent_id::text from dokument_korrespondenten dk
              join korrespondenten k on k.id = dk.korrespondent_id
             where dk.dokument_id = d.id and k.abgleich = 'automatisch') as korrespondent,
           (select dd.dokumenttyp_id::text from dokument_dokumenttypen dd
              join dokumenttypen ty on ty.id = dd.dokumenttyp_id
             where dd.dokument_id = d.id and ty.abgleich = 'automatisch') as dokumenttyp,
           array(select dt.tag_id::text from dokument_tags dt join tags t on t.id = dt.tag_id
                  where dt.dokument_id = d.id and t.abgleich = 'automatisch') as tags
      from dokumente d
      join lateral (select x.art from einordnungen x where x.dokument_id = d.id
                     order by x.erstellt_am desc, x.id desc limit 1) e on true
      ${merkmalJoins}
     where not exists (select 1 from loeschungen l where l.dokument_id = d.id and l.bestaetigt_am is not null)
     order by d.eingegangen_am desc, d.id desc
     limit ${MAX_BEISPIELE}`);
  return [...zeilen].map((z) => ({
    woerter: woerterAus(z.text),
    art: z.art,
    korrespondent: z.korrespondent,
    dokumenttyp: z.dokumenttyp,
    tags: z.tags,
  }));
}

/**
 * Lernt neu, wenn sich seit dem letzten Training etwas getan hat (oder es kein Modell gibt). Unter der Mindestmenge
 * gibt es kein Modell. Wird zwischen dem Lesen der Beispiele und dem Schreiben eine Löschung bestätigt, verwirft
 * Postgres das Modell (belegt_klassifikator_aktuell); der nächste Lauf lernt ohne das Dokument.
 */
export async function klassifikatorLernen(
  db: Datenbank,
  { immer = false }: { immer?: boolean } = {},
): Promise<{ gelernt: boolean; beispiele: number }> {
  const { stand, loeschungen } = await aktuellerStand(db);
  const [bisher] = await db.select({ stand: klassifikator.stand }).from(klassifikator);
  if (!immer && bisher?.stand === stand) return { gelernt: false, beispiele: 0 };
  const beispiele = await beispieleLaden(db);
  const modell = lernen(beispiele);
  if (!modell) {
    await db.delete(klassifikator);
    return { gelernt: false, beispiele: beispiele.length };
  }
  const zeile = { id: 1, modell, beispiele: beispiele.length, stand, loeschungen, trainiertAm: new Date() };
  const geschrieben = await db
    .insert(klassifikator)
    .values(zeile)
    .onConflictDoUpdate({ target: klassifikator.id, set: zeile })
    .returning({ id: klassifikator.id });
  return { gelernt: geschrieben.length > 0, beispiele: beispiele.length };
}

/** Das Modell, je Prozess einmal je Training geladen */
let zwischenspeicher: { am: number; modell: Modell } | null = null;

async function modellLaden(db: Datenbank): Promise<Modell | null> {
  const [z] = await db.select({ am: klassifikator.trainiertAm }).from(klassifikator);
  if (!z) {
    zwischenspeicher = null;
    return null;
  }
  if (zwischenspeicher?.am !== z.am.getTime()) {
    const [voll] = await db.select({ modell: klassifikator.modell }).from(klassifikator);
    if (!voll) return null;
    zwischenspeicher = { am: z.am.getTime(), modell: voll.modell as Modell };
  }
  return zwischenspeicher.modell;
}

type Erklaerung = Omit<Treffer, "wert">;

export interface GelernterVorschlag {
  art: ({ wert: string } & Erklaerung) | null;
  korrespondent: ({ id: string; name: string } & Erklaerung) | null;
  dokumenttyp: ({ id: string; name: string } & Erklaerung) | null;
  tags: ({ id: string; name: string; farbe: string } & Erklaerung)[];
}

const erklaerung = ({ sicherheit, anzahl, woerter }: Treffer): Erklaerung => ({ sicherheit, anzahl, woerter });

/**
 * Was der Klassifikator für ein Dokument vorschlägt, mit heutigen Namen. Korrespondenten, Typen und Tags, die es nicht
 * mehr gibt oder die nicht mehr „automatisch“ lernen, fallen weg. null ohne Modell oder ohne Vorschlag.
 */
export async function gelerntVorschlagZu(db: Datenbank, dokumentId: string): Promise<GelernterVorschlag | null> {
  const modell = await modellLaden(db);
  if (!modell) return null;
  const text = await textFuer(db, dokumentId);
  if (text === null) return null;
  const v = vorhersagen(modell, woerterAus(text));
  const auto = sql`abgleich = 'automatisch'`;
  const [k, ty, t] = await Promise.all([
    v.korrespondent
      ? db
          .select({ id: korrespondenten.id, name: korrespondenten.name })
          .from(korrespondenten)
          .where(sql`${eq(korrespondenten.id, v.korrespondent.wert)} and ${auto}`)
      : [],
    v.dokumenttyp
      ? db
          .select({ id: dokumenttypen.id, name: dokumenttypen.name })
          .from(dokumenttypen)
          .where(sql`${eq(dokumenttypen.id, v.dokumenttyp.wert)} and ${auto}`)
      : [],
    v.tags.length
      ? db
          .select({ id: tags.id, name: tags.name, farbe: tags.farbe })
          .from(tags)
          .where(
            sql`${inArray(
              tags.id,
              v.tags.map((x) => x.wert),
            )} and ${auto}`,
          )
      : [],
  ]);
  const ergebnis: GelernterVorschlag = {
    art: v.art ? { wert: v.art.wert, ...erklaerung(v.art) } : null,
    korrespondent: k[0] && v.korrespondent ? { ...k[0], ...erklaerung(v.korrespondent) } : null,
    dokumenttyp: ty[0] && v.dokumenttyp ? { ...ty[0], ...erklaerung(v.dokumenttyp) } : null,
    tags: t.map((x) => ({ ...x, ...erklaerung(v.tags.find((y) => y.wert === x.id)!) })),
  };
  return ergebnis.art || ergebnis.korrespondent || ergebnis.dokumenttyp || ergebnis.tags.length ? ergebnis : null;
}

/** Wann und aus wie vielen Dokumenten zuletzt gelernt wurde (Verfahrensdokumentation); null ohne Modell */
export async function klassifikatorStand(db: Datenbank): Promise<{ am: Date; beispiele: number } | null> {
  const [z] = await db
    .select({ am: klassifikator.trainiertAm, beispiele: klassifikator.beispiele })
    .from(klassifikator);
  return z ?? null;
}
