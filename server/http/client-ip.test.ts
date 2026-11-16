import { describe, expect, it } from "vitest";
import { readEnv } from "../env.ts";
import { CLIENT_IP_HEADER, clientIp, mitClientIp, proxysLesen } from "./client-ip.ts";

describe("Adresse des Clients", () => {
  const proxys = proxysLesen("172.31.250.2, 10.0.0.0/8 fd00::/8");

  it("nimmt ohne vertrauenswürdige Proxys die Verbindung und ignoriert X-Forwarded-For", () => {
    expect(clientIp("192.0.2.9", "198.51.100.1", undefined)).toBe("192.0.2.9");
    expect(clientIp("::ffff:192.0.2.9", null, undefined)).toBe("192.0.2.9");
    expect(clientIp(undefined, "198.51.100.1", undefined)).toBeUndefined();
  });

  it("nimmt X-Forwarded-For nur, wenn die Verbindung von einem gelisteten Proxy kommt", () => {
    expect(clientIp("192.0.2.9", "198.51.100.1", proxys)).toBe("192.0.2.9");
    expect(clientIp("172.31.250.2", "198.51.100.1", proxys)).toBe("198.51.100.1");
    expect(clientIp("::ffff:172.31.250.2", "198.51.100.1", proxys)).toBe("198.51.100.1");
    expect(clientIp("fd00::5", "2001:db8::1", proxys)).toBe("2001:db8::1");
  });

  it("nimmt den rechtesten Eintrag, der kein vertrauenswürdiger Proxy ist", () => {
    // Der Client hat 1.1.1.1 vorangestellt; 198.51.100.1 hat der äußere Proxy gesehen
    expect(clientIp("172.31.250.2", "1.1.1.1, 198.51.100.1, 10.1.2.3", proxys)).toBe("198.51.100.1");
    expect(clientIp("172.31.250.2", "10.1.2.3, 10.0.0.1", proxys)).toBe("10.1.2.3");
    expect(clientIp("172.31.250.2", "kein-ip, 10.0.0.1", proxys)).toBe("172.31.250.2");
    expect(clientIp("172.31.250.2", null, proxys)).toBe("172.31.250.2");
  });

  it("ersetzt einen eingehenden Header für Better Auth", () => {
    const req = new Request("http://x/", { headers: { [CLIENT_IP_HEADER]: "6.6.6.6" } });
    expect(mitClientIp(req, "192.0.2.9").headers.get(CLIENT_IP_HEADER)).toBe("192.0.2.9");
    expect(mitClientIp(req, undefined).headers.has(CLIENT_IP_HEADER)).toBe(false);
  });

  it("lehnt eine ungültige Liste beim Start ab", () => {
    expect(proxysLesen(undefined)).toBeUndefined();
    expect(() => readEnv({ BELEGT_TRUSTED_PROXIES: "172.31.250.0/33" })).toThrow(/BELEGT_TRUSTED_PROXIES/);
    expect(() => readEnv({ BELEGT_TRUSTED_PROXIES: "caddy" })).toThrow(/BELEGT_TRUSTED_PROXIES/);
    expect(readEnv({ BELEGT_TRUSTED_PROXIES: "172.31.250.2" }).BELEGT_TRUSTED_PROXIES).toBe("172.31.250.2");
  });
});
