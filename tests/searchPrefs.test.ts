import { describe, it, expect } from "vitest";
import {
  titleMatches,
  locationMatches,
  DEFAULT_INCLUDE_KEYWORDS,
  DEFAULT_EXCLUDE_KEYWORDS,
} from "@/lib/searchPrefs";

const defaults = {
  includeKeywords: DEFAULT_INCLUDE_KEYWORDS,
  excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
};

describe("titleMatches", () => {
  it("keeps a junior software engineering title", () => {
    expect(titleMatches(defaults, "Software Engineer")).toBe(true);
    expect(titleMatches(defaults, "Backend Developer")).toBe(true);
    expect(titleMatches(defaults, "Full Stack Engineer (New Grad)")).toBe(true);
  });

  it("drops seniority-excluded titles even if they include a keyword", () => {
    expect(titleMatches(defaults, "Senior Software Engineer")).toBe(false);
    expect(titleMatches(defaults, "Staff Backend Engineer")).toBe(false);
    expect(titleMatches(defaults, "Engineering Manager")).toBe(false);
  });

  it("drops titles with no include keyword", () => {
    expect(titleMatches(defaults, "Account Executive")).toBe(false);
    expect(titleMatches(defaults, "Product Designer")).toBe(false);
  });

  it("matches whole words only — 'swe' must not hit 'Swedish'", () => {
    const prefs = { includeKeywords: ["swe"], excludeKeywords: [] };
    expect(titleMatches(prefs, "SWE Intern")).toBe(true);
    expect(titleMatches(prefs, "Swedish Translator")).toBe(false);
  });

  it("excludes 'lead' without catching 'leader' substrings in include", () => {
    const prefs = { includeKeywords: ["engineer"], excludeKeywords: ["lead"] };
    expect(titleMatches(prefs, "Lead Engineer")).toBe(false);
    expect(titleMatches(prefs, "Engineer, Team Leader")).toBe(true);
  });

  it("treats hyphen and space variants of a keyword the same", () => {
    expect(titleMatches(defaults, "Back-End Engineer")).toBe(true);
    expect(titleMatches(defaults, "Back End Engineer")).toBe(true);
    expect(titleMatches(defaults, "Front-end Developer")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(titleMatches(defaults, "SOFTWARE ENGINEER")).toBe(true);
    expect(titleMatches(defaults, "senior backend")).toBe(false);
  });
});

describe("locationMatches", () => {
  const prefs = { locationKeywords: ["india", "bangalore", "remote"] };

  it("always passes remote roles", () => {
    expect(locationMatches(prefs, "San Francisco", true)).toBe(true);
    expect(locationMatches({ locationKeywords: [] }, "Anywhere", true)).toBe(true);
  });

  it("passes unknown (undefined) locations for human review", () => {
    expect(locationMatches(prefs, undefined)).toBe(true);
  });

  it("matches a preferred location substring, case-insensitively", () => {
    expect(locationMatches(prefs, "Bangalore, India")).toBe(true);
    expect(locationMatches(prefs, "BANGALORE")).toBe(true);
  });

  it("rejects a non-preferred concrete location", () => {
    expect(locationMatches(prefs, "Berlin, Germany")).toBe(false);
  });
});
