import { alltagApi } from "./api-alltag.ts";
import { betriebApi } from "./api-betrieb.ts";
import { dokumenteApi } from "./api-dokumente.ts";
import { ordnungApi } from "./api-ordnung.ts";
import { paperlessApi } from "./api-paperless.ts";
import { standApi } from "./api-stand.ts";
import { workflowsApi } from "./api-workflows.ts";
import { zugangApi } from "./api-zugang.ts";

/* Alle Aufrufe der Schnittstelle in einem Objekt; die Bereiche stehen in den Dateien api-*.ts */

export type { GespeicherteAnsicht, Start } from "./api-alltag.ts";
export { ApiFehler } from "./api-aufruf.ts";
export type {
  AktionenProtokoll,
  Befund,
  Bericht,
  Einstellungen,
  Ereignisart,
  PostfachAktion,
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
  Erklaerung,
  GelernterVorschlag,
  GeteilterLink,
  Gruppe,
  Loeschung,
  MailAnsicht,
  Notiz,
  SeitenOperation,
  Verknuepfung,
} from "./api-dokumente.ts";
export {
  ansichtUrl,
  archivfassungUrl,
  dateiUrl,
  exportUrl,
  PRO_SEITE,
  seiteUrl,
  trennblattUrl,
  vorschaubildUrl,
} from "./api-dokumente.ts";
export type {
  Abgleich,
  Dokumenttyp,
  Feld,
  Korrespondent,
  ListenFilter,
  Ordnung,
  OrdnungAenderung,
  OrdnungsVorschlag,
  SammelEinordnung,
  SammelErgebnis,
  Tag,
  TagKurz,
} from "./api-ordnung.ts";
export type { ImportLauf, ImportStatus, ImportZuordnung, PaperlessQuelle, ZielArt } from "./api-paperless.ts";
export type {
  BackupLauf,
  BackupStand,
  Betriebsstand,
  DatenbankProblem,
  Datenbankzugriff,
  TabellenRechte,
} from "./api-stand.ts";
export type {
  Ausloeser,
  Workflow,
  WorkflowAktion,
  WorkflowBedingungen,
  WorkflowLauf,
  WorkflowQuelle,
} from "./api-workflows.ts";
export type { ApiToken, Ich, Zugaenge } from "./api-zugang.ts";

export const api = {
  ...zugangApi,
  ...dokumenteApi,
  ...ordnungApi,
  ...betriebApi,
  ...paperlessApi,
  ...alltagApi,
  ...workflowsApi,
  ...standApi,
};
