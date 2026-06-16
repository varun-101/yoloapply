import { describe, it, expect } from "vitest";
import { parseList, remoteScope, normalizeEmployment } from "@/lib/discovery/remoteParse";

describe("parseList", () => {
  it("returns trimmed tokens from an array", () => {
    expect(parseList([" India ", "USA", ""])).toEqual(["India", "USA"]);
  });

  it("parses a python-style quoted list", () => {
    expect(parseList("['India','United States']")).toEqual(["India", "United States"]);
    expect(parseList('["UK", "Canada"]')).toEqual(["UK", "Canada"]);
  });

  it("parses a plain comma-separated string", () => {
    expect(parseList("India, USA , UK")).toEqual(["India", "USA", "UK"]);
  });

  it("returns [] for null/undefined/empty", () => {
    expect(parseList(null)).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
    expect(parseList("")).toEqual([]);
  });
});

describe("remoteScope", () => {
  it("treats an empty restriction list as fully remote", () => {
    expect(remoteScope([])).toEqual({ location: "Remote", isRemote: true });
  });

  it("treats worldwide/anywhere as fully remote", () => {
    expect(remoteScope(["Worldwide"]).isRemote).toBe(true);
    expect(remoteScope(["Anywhere"]).isRemote).toBe(true);
    expect(remoteScope(["Fully Remote"]).isRemote).toBe(true);
  });

  it("treats a region-locked remote as geo-restricted, not global", () => {
    const scope = remoteScope(["Remote (US only)"]);
    expect(scope.isRemote).toBe(false);
    expect(scope.location).toBe("Remote (US only)");
  });

  it("joins multiple region restrictions", () => {
    const scope = remoteScope(["USA", "Canada"]);
    expect(scope.isRemote).toBe(false);
    expect(scope.location).toBe("USA, Canada");
  });

  it("stays restricted if any token is region-locked", () => {
    expect(remoteScope(["Worldwide", "US only"]).isRemote).toBe(false);
  });
});

describe("normalizeEmployment", () => {
  it("maps known employment types", () => {
    expect(normalizeEmployment("Internship")).toBe("Internship");
    expect(normalizeEmployment("full-time")).toBe("Full Time");
    expect(normalizeEmployment("Part Time")).toBe("Part Time");
    expect(normalizeEmployment("Freelance")).toBe("Contract");
    expect(normalizeEmployment("contract")).toBe("Contract");
  });

  it("returns undefined for unknown or empty input", () => {
    expect(normalizeEmployment("Volunteer")).toBeUndefined();
    expect(normalizeEmployment(null)).toBeUndefined();
    expect(normalizeEmployment(undefined)).toBeUndefined();
  });
});
