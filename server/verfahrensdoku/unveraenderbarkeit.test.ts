import { describe, expect, it } from "vitest";
import { unveraenderbarkeit } from "./unveraenderbarkeit.ts";

describe("Verfahrensdokumentation: Unveränderbarkeit", () => {
  const basis = {
    rechte: { absatz: "Rechte.", liste: [] },
    pruefwert: null,
    befunde: 0,
    letzterLauf: null,
  };

  it("nennt clientseitige S3-Verschlüsselung nur, wenn sie aktiv ist", () => {
    const ohne = unveraenderbarkeit({ ...basis, objektsperre: true, s3Verschluesselt: false });
    expect(ohne.absaetze.join("\n")).toContain("Object Lock im Modus COMPLIANCE");
    expect(ohne.absaetze.join("\n")).not.toContain("AES-256-GCM");

    const mit = unveraenderbarkeit({ ...basis, objektsperre: true, s3Verschluesselt: true });
    expect(mit.absaetze.join("\n")).toContain("clientseitig mit AES-256-GCM");
    expect(mit.absaetze.join("\n")).toContain("Klartext-Hash");
  });
});
