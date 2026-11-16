/*
 * Ein Papierkorb leert sich von selbst (Gmail nach 30 Tagen, Exchange nach Richtlinie); Verschieben dorthin ist Löschen
 * mit Verzögerung und gilt in den Aktionen nach dem Abholen wie Löschen. Erkannt an IMAP SPECIAL-USE \Trash (RFC 6154,
 * 2), an der JMAP-Rolle trash (RFC 8621, 2: Rollen aus dem IANA-Register von RFC 8457) und an gängigen Namen für
 * Server, die beides nicht melden.
 */
const NAMEN = new Set([
  "trash",
  "papierkorb",
  "deleted items",
  "deleted messages",
  "gelöschte elemente",
  "gelöschte objekte",
  "gelöschte nachrichten",
]);

/** Ist der Ordner mit diesem Namen (letzter Teil des Pfads) ein Papierkorb? */
export const papierkorbName = (name: string) => NAMEN.has(name.trim().toLowerCase());
