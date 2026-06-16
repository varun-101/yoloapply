import { describe, it, expect } from "vitest";
import { dedupeFingerprint, canonicalizeUrl } from "@/lib/discovery/pipeline";

describe("dedupeFingerprint", () => {
  it("normalizes case, punctuation, and whitespace to a stable key", () => {
    const a = dedupeFingerprint("Acme, Inc.", "Software Engineer");
    const b = dedupeFingerprint("acme inc", "software   engineer");
    expect(a).toBe(b);
    expect(a).toBe("acme inc|software engineer");
  });

  it("returns null when either half is empty after normalization", () => {
    expect(dedupeFingerprint("", "Engineer")).toBeNull();
    expect(dedupeFingerprint("Acme", "!!!")).toBeNull();
  });

  it("distinguishes genuinely different postings", () => {
    expect(dedupeFingerprint("Acme", "Backend Engineer")).not.toBe(
      dedupeFingerprint("Acme", "Frontend Engineer")
    );
  });
});

describe("canonicalizeUrl", () => {
  it("lowercases host, strips www, hash, and trailing slash", () => {
    expect(canonicalizeUrl("https://WWW.Acme.com/Jobs/42/#apply")).toBe(
      "https://acme.com/Jobs/42"
    );
  });

  it("strips utm_* and tracking params but keeps real query params", () => {
    expect(canonicalizeUrl("https://acme.com/j?utm_source=x&id=42")).toBe(
      "https://acme.com/j?id=42"
    );
  });

  it("sorts query params so order does not defeat dedupe", () => {
    expect(canonicalizeUrl("https://acme.com/j?b=2&a=1")).toBe(
      canonicalizeUrl("https://acme.com/j?a=1&b=2")
    );
  });

  it("returns undefined for empty or invalid input", () => {
    expect(canonicalizeUrl(undefined)).toBeUndefined();
    expect(canonicalizeUrl("not a url")).toBeUndefined();
  });
});
