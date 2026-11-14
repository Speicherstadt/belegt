/*
 * Teilt ein MBOX-Archiv (Export aus Thunderbird, Google Takeout und anderen) in einzelne Mails. Eine Mail beginnt mit
 * einer Zeile „From “ am Zeilenanfang (RFC 4155). Zeilen im Text, die selbst mit „From “ beginnen, sind beim
 * Schreiben mit „>“ maskiert (mboxrd: „>From “, „>>From “); beim Lesen fällt genau ein „>“ weg. Die Trennzeile
 * gehört nicht zur Mail.
 */

const TRENNER = /^From [^\r\n]*\r?\n/gm;
const MASKIERT = /^>(>*From )/gm;

/** Die Mails des Archivs als Rohdaten, in ihrer Reihenfolge */
export function mboxAufteilen(archiv: Uint8Array): Uint8Array[] {
  // latin1 bildet jedes Byte auf genau ein Zeichen ab: die Rohdaten bleiben Byte für Byte erhalten
  const text = Buffer.from(archiv).toString("latin1");
  const starts = [...text.matchAll(TRENNER)].map((t) => ({ trenner: t.index, inhalt: t.index + t[0].length }));
  return starts.map((s, i) => {
    let mail = text.slice(s.inhalt, starts[i + 1]?.trenner ?? text.length);
    // Die Leerzeile vor der nächsten Trennzeile gehört zum Format, nicht zur Mail
    if (starts[i + 1]) mail = mail.replace(/\r?\n$/, "");
    return new Uint8Array(Buffer.from(mail.replace(MASKIERT, "$1"), "latin1"));
  });
}
