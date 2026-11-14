import { type Dateispeicher, dateispeicher } from "@firsttris/gobd-kern/dateispeicher";
import type { Env } from "../env.ts";
import { type SperrbarerSpeicher, s3Speicher } from "./s3.ts";

/** Der Speicher aus der Umgebung: S3 mit Object Lock, wenn S3_ENDPUNKT gesetzt ist, sonst DOCUMENTS_DIR */
export function speicherAusEnv(env: Env): { speicher: Dateispeicher; sperrbar: SperrbarerSpeicher | null } {
  if (!env.S3_ENDPUNKT) return { speicher: dateispeicher({ verzeichnis: () => env.DOCUMENTS_DIR }), sperrbar: null };
  if (!env.S3_BUCKET || !env.S3_ZUGANG_ID || !env.S3_ZUGANG_GEHEIMNIS)
    throw new Error("Mit S3_ENDPUNKT braucht es S3_BUCKET, S3_ZUGANG_ID und S3_ZUGANG_GEHEIMNIS");
  const s3 = s3Speicher({
    endpunkt: env.S3_ENDPUNKT,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    zugangId: env.S3_ZUGANG_ID,
    zugangGeheimnis: env.S3_ZUGANG_GEHEIMNIS,
    pfadStil: env.S3_PFAD_STIL,
    sperreTage: env.S3_SPERRE_TAGE,
  });
  return { speicher: s3, sperrbar: s3 };
}
