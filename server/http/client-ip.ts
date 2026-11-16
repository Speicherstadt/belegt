import { BlockList, isIP } from "node:net";

/*
 * Adresse des Clients für die Begrenzung der Anmeldeversuche und die Sitzungen von Better Auth. Better Auth liest sie aus
 * einem Header (getIP in node_modules/@better-auth/core/dist/utils/ip.mjs, Standard x-forwarded-for) und kennt die
 * Verbindung selbst nicht; sein trustedProxies wirkt nur innerhalb des Headers. Ohne Prüfung könnte also jeder, der den
 * Server direkt erreicht, mit einem erfundenen X-Forwarded-For je Versuch einen neuen Zähler bekommen. Deshalb setzt
 * Belegt einen eigenen Header aus der Adresse der Verbindung und nimmt X-Forwarded-For nur, wenn die Verbindung von
 * einem Proxy aus BELEGT_TRUSTED_PROXIES kommt: dann den rechtesten Eintrag, der kein vertrauenswürdiger Proxy ist.
 */

/** Header, den Better Auth liest (advanced.ipAddress.ipAddressHeaders in server/auth.ts); ein eingehender gilt nie */
export const CLIENT_IP_HEADER = "x-belegt-client-ip";

/** ::ffff:192.0.2.1 (IPv4 über einen IPv6-Socket) als 192.0.2.1 */
function normalisieren(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return v4 ? v4[1]! : ip;
}

/** Liste aus BELEGT_TRUSTED_PROXIES: Adressen oder Netze (CIDR), mit Komma oder Leerzeichen getrennt; wirft bei Fehlern */
export function proxysLesen(text: string | undefined): BlockList | undefined {
  const eintraege = (text ?? "").split(/[\s,]+/).filter(Boolean);
  if (!eintraege.length) return undefined;
  const liste = new BlockList();
  for (const e of eintraege) {
    const [adresse = "", praefix] = e.split("/");
    const art = isIP(adresse);
    const laenge = praefix === undefined ? undefined : Number(praefix);
    const max = art === 4 ? 32 : 128;
    if (!art || (laenge !== undefined && !(Number.isInteger(laenge) && laenge >= 0 && laenge <= max)))
      throw new Error(`BELEGT_TRUSTED_PROXIES: „${e}“ ist keine IP-Adresse und kein Netz (CIDR)`);
    const familie = art === 4 ? "ipv4" : "ipv6";
    if (laenge === undefined) liste.addAddress(adresse, familie);
    else liste.addSubnet(adresse, laenge, familie);
  }
  return liste;
}

const vertraut = (proxys: BlockList, ip: string) => {
  const art = isIP(ip);
  return art !== 0 && proxys.check(ip, art === 4 ? "ipv4" : "ipv6");
};

/** Adresse des Clients aus der Verbindung und, nur hinter einem vertrauenswürdigen Proxy, aus X-Forwarded-For */
export function clientIp(
  verbindung: string | undefined,
  forwardedFor: string | null,
  proxys: BlockList | undefined,
): string | undefined {
  if (!verbindung) return undefined;
  const direkt = normalisieren(verbindung);
  if (!proxys || !forwardedFor || !vertraut(proxys, direkt)) return direkt;
  const kette = forwardedFor
    .split(",")
    .map((e) => normalisieren(e.trim()))
    .filter(Boolean);
  for (let i = kette.length - 1; i >= 0; i--) {
    const ip = kette[i]!;
    // Ein unlesbarer Eintrag vor dem Proxy: nicht raten, sondern die Verbindung nehmen (gemeinsamer Zähler)
    if (!isIP(ip)) return direkt;
    if (!vertraut(proxys, ip)) return ip;
  }
  return kette[0] ?? direkt;
}

/** Die Anfrage für Better Auth: eingehender CLIENT_IP_HEADER entfernt, ermittelte Adresse gesetzt */
export function mitClientIp(req: Request, ip: string | undefined): Request {
  const headers = new Headers(req.headers);
  headers.delete(CLIENT_IP_HEADER);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(req, { headers });
}
