import { alltagApi } from "./api-alltag.ts";
import { benachrichtigungenApi } from "./api-benachrichtigungen.ts";
import { betriebApi } from "./api-betrieb.ts";
import { dokumenteApi } from "./api-dokumente.ts";
import { kontoApi } from "./api-konto.ts";
import { ordnungApi } from "./api-ordnung.ts";
import { paperlessApi } from "./api-paperless.ts";
import { standApi } from "./api-stand.ts";
import { workflowsApi } from "./api-workflows.ts";
import { zugangApi } from "./api-zugang.ts";

/* Alle Aufrufe der Schnittstelle in einem Objekt; die Bereiche stehen in den Dateien api-*.ts */

export type { GespeicherteAnsicht, Start } from "./api-alltag.ts";
export { ApiFehler } from "./api-aufruf.ts";
export type { Anlaesse, Benachrichtigungen, BenachrichtigungsEinstellungen } from "./api-benachrichtigungen.ts";
export type {
  AktionenProtokoll,
  Befund,
  Bericht,
  Einstellungen,
  Ereignisart,
  Fristvorlage,
  PostfachAktion,
  Quelle,
  QuelleAenderung,
  Regel,
  Sperre,
  Uebersicht,
  Verfahrensdoku,
  Webhook,
  WebhookAenderung,
} from "./api-betrieb.ts";
export { EREIGNISSE } from "./api-betrieb.ts";
export type {
  Ableitungsart,
  Art,
  Dokument,
  Doppelt,
  Einordnung,
  Eintrag,
  ERechnung,
  ERechnungsPruefung,
  Ereignis,
  Erklaerung,
  GelernterVorschlag,
  GeteilterLink,
  Gruppe,
  Hochgeladen,
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
  nachweisUrl,
  PRO_SEITE,
  seiteUrl,
  trennblattUrl,
  vorschaubildUrl,
  zipUrl,
} from "./api-dokumente.ts";
export type { Konto, ZweiterSchritt } from "./api-konto.ts";
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
  Weitergabe,
  Workflow,
  WorkflowAktion,
  WorkflowBedingungen,
  WorkflowLauf,
  WorkflowQuelle,
} from "./api-workflows.ts";
export type { ApiToken, Ich, Zugaenge } from "./api-zugang.ts";

export const api = {
  ...zugangApi,
  ...kontoApi,
  ...dokumenteApi,
  ...ordnungApi,
  ...betriebApi,
  ...paperlessApi,
  ...alltagApi,
  ...workflowsApi,
  ...standApi,
  ...benachrichtigungenApi,
};
