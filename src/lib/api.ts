import { betriebApi } from "./api-betrieb.ts";
import { dokumenteApi } from "./api-dokumente.ts";
import { ordnungApi } from "./api-ordnung.ts";
import { zugangApi } from "./api-zugang.ts";

/* Alle Aufrufe der Schnittstelle in einem Objekt; die Bereiche stehen in den Dateien api-*.ts */

export { ApiFehler } from "./api-aufruf.ts";
export type {
  Befund,
  Bericht,
  Einstellungen,
  Ereignisart,
  Quelle,
  Regel,
  Sperre,
  Uebersicht,
  Verfahrensdoku,
  Webhook,
} from "./api-betrieb.ts";
export { EREIGNISSE } from "./api-betrieb.ts";
export type {
  Ableitungsart,
  Art,
  Dokument,
  Einordnung,
  Eintrag,
  ERechnung,
  Ereignis,
  GeteilterLink,
  Gruppe,
  Loeschung,
  MailAnsicht,
  SeitenOperation,
  Verknuepfung,
} from "./api-dokumente.ts";
export {
  ansichtUrl,
  dateiUrl,
  exportUrl,
  PRO_SEITE,
  seiteUrl,
  trennblattUrl,
  vorschaubildUrl,
} from "./api-dokumente.ts";
export type {
  Dokumenttyp,
  Feld,
  ListenFilter,
  Ordnung,
  OrdnungAenderung,
  OrdnungsVorschlag,
  SammelEinordnung,
  SammelErgebnis,
  Tag,
  TagKurz,
} from "./api-ordnung.ts";
export type { ApiToken, Ich, Zugaenge } from "./api-zugang.ts";

export const api = { ...zugangApi, ...dokumenteApi, ...ordnungApi, ...betriebApi };
