import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Ein echter Zeitstempeldienst für Tests, gebaut mit OpenSSL (`openssl ts -reply`): eigenes Zertifikat mit
 * extendedKeyUsage timeStamping, Antworten per HTTP. Ohne openssl gibt es ihn nicht (Tests werden übersprungen).
 */
export const opensslDa = spawnSync("openssl", ["version"], { stdio: "ignore" }).status === 0;

export async function testTsa() {
  const dir = mkdtempSync(join(tmpdir(), "belegt-tsa-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      join(dir, "tsa.key"),
      "-out",
      join(dir, "tsa.crt"),
      "-days",
      "2",
      "-subj",
      "/CN=Belegt Test-TSA",
      "-addext",
      "extendedKeyUsage=critical,timeStamping",
      "-addext",
      "keyUsage=critical,digitalSignature",
    ],
    { stdio: "ignore" },
  );
  writeFileSync(join(dir, "serial"), "01\n");
  writeFileSync(
    join(dir, "tsa.cnf"),
    `[ tsa ]\ndefault_tsa = t\n[ t ]\ndir = ${dir}\nserial = $dir/serial\nsigner_cert = $dir/tsa.crt\nsigner_key = $dir/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\ndigests = sha256\naccuracy = secs:1\ness_cert_id_alg = sha256\n`,
  );
  const zustand = { ablehnen: false, anfragen: 0 };
  const server: Server = createServer((req, res) => {
    const teile: Buffer[] = [];
    req.on("data", (t: Buffer) => teile.push(t));
    req.on("end", () => {
      zustand.anfragen++;
      if (zustand.ablehnen) {
        res.statusCode = 503;
        return res.end();
      }
      writeFileSync(join(dir, "q.tsq"), Buffer.concat(teile));
      execFileSync(
        "openssl",
        ["ts", "-reply", "-config", join(dir, "tsa.cnf"), "-queryfile", join(dir, "q.tsq"), "-out", join(dir, "r.tsr")],
        { stdio: "ignore" },
      );
      res.setHeader("content-type", "application/timestamp-reply");
      res.end(readFileSync(join(dir, "r.tsr")));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/tsa`,
    zertifikat: join(dir, "tsa.crt"),
    zustand,
    /** Prüft ein Token unabhängig mit openssl ts -verify gegen den Hash */
    pruefen(token: Uint8Array, hashHex: string): boolean {
      writeFileSync(join(dir, "token.der"), token);
      return (
        spawnSync(
          "openssl",
          [
            "ts",
            "-verify",
            "-digest",
            hashHex,
            "-token_in",
            "-in",
            join(dir, "token.der"),
            "-CAfile",
            join(dir, "tsa.crt"),
          ],
          { stdio: "ignore" },
        ).status === 0
      );
    },
    async schliessen() {
      await new Promise<void>((ok) => server.close(() => ok()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
