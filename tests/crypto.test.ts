import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, sha256Hex } from "@/lib/crypto";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext secret", () => {
    const secret = "sk-deepseek-abc123";
    const token = encryptSecret(secret);
    expect(decryptSecret(token)).toBe(secret);
  });

  it("round-trips unicode and long secrets", () => {
    for (const secret of ["p@ss—wörd🔐", "a".repeat(2000)]) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it("emits the versioned 4-part token format", () => {
    const token = encryptSecret("hello");
    const parts = token.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a malformed token", () => {
    expect(() => decryptSecret("not-a-token")).toThrow(/Unrecognized secret token/);
    expect(() => decryptSecret("v2.a.b.c")).toThrow(/Unrecognized secret token/);
  });

  it("rejects a tampered ciphertext (auth tag mismatch)", () => {
    const [v, iv, , tag] = encryptSecret("hello").split(".");
    const forged = `${v}.${iv}.${Buffer.from("evil").toString("base64")}.${tag}`;
    expect(() => decryptSecret(forged)).toThrow();
  });
});

describe("sha256Hex", () => {
  it("is deterministic and 64 hex chars", () => {
    const h = sha256Hex("yolo_token");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("yolo_token")).toBe(h);
  });

  it("differs for different inputs", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});
