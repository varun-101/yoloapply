import { describe, it, expect } from "vitest";
import { instahyreLocations, instahyreJobIdFromUrl } from "@/lib/discovery/instahyre";
import type { SearchPrefs } from "@/lib/searchPrefs";

function prefs(locationKeywords: string[]): SearchPrefs {
  return {
    userId: "u",
    includeKeywords: [],
    excludeKeywords: [],
    locationKeywords,
    discoveryEnabled: true,
    scoreMaxPerScan: 45,
    scoreRecencyDays: 21,
  };
}

describe("instahyreLocations", () => {
  it("maps a user's cities onto Instahyre's own vocabulary", () => {
    expect(instahyreLocations([prefs(["Bengaluru", "gurugram"])]).sort()).toEqual(["Bangalore", "Gurgaon"]);
  });

  it("treats remote keywords as Work From Home", () => {
    expect(instahyreLocations([prefs(["remote"])])).toEqual(["Work From Home"]);
  });

  it("unions across participating users", () => {
    expect(instahyreLocations([prefs(["mumbai"]), prefs(["pune", "mumbai"])]).sort()).toEqual([
      "Mumbai",
      "Pune",
    ]);
  });

  it("resolves free text around a city name", () => {
    expect(instahyreLocations([prefs(["Navi Mumbai"])])).toEqual(["Mumbai"]);
    // A city inside the keyword wins over the country-wide value beside it.
    expect(instahyreLocations([prefs(["bangalore, india"])])).toEqual(["Bangalore"]);
  });

  // The sweep samples only a few hundred of ~15k postings, so one unplaceable
  // keyword must not spend that budget country-wide for everyone else.
  it("drops a location it can't place rather than widening the query", () => {
    expect(instahyreLocations([prefs(["bangalore"]), prefs(["Berlin"])])).toEqual(["Bangalore"]);
  });

  it("widens only when nothing at all maps", () => {
    expect(instahyreLocations([prefs([])])).toEqual(["Anywhere in India"]);
    expect(instahyreLocations([prefs(["Berlin"]), prefs(["Kerala"])])).toEqual(["Anywhere in India"]);
  });

  it("collapses to the country query when one is already country-wide", () => {
    expect(instahyreLocations([prefs(["india", "mumbai"])])).toEqual(["Anywhere in India"]);
  });
});

// Instahyre's HTML pages answer a server-side fetch with a Cloudflare challenge
// (403), so reading a posting from its URL depends entirely on recovering this
// id and going to the JSON API instead.
describe("instahyreJobIdFromUrl", () => {
  it("pulls the job id out of a posting URL", () => {
    expect(
      instahyreJobIdFromUrl("https://www.instahyre.com/job-429079-backend-engineer-ai-at-echos-bangalore-gurgaon/")
    ).toBe(429079);
  });

  it("handles a bare host and a missing scheme", () => {
    expect(instahyreJobIdFromUrl("instahyre.com/job-430197-senior-data-analyst-at-indium/")).toBe(430197);
  });

  it("ignores other boards so they keep their normal scrape path", () => {
    expect(instahyreJobIdFromUrl("https://boards.greenhouse.io/acme/jobs/12345")).toBeNull();
    expect(instahyreJobIdFromUrl("https://www.linkedin.com/jobs/view/999")).toBeNull();
    // Lookalike host — must not match a domain that merely ends in the name.
    expect(instahyreJobIdFromUrl("https://notinstahyre.com/job-1-x/")).toBeNull();
  });

  it("returns null for an Instahyre URL that isn't a posting", () => {
    expect(instahyreJobIdFromUrl("https://www.instahyre.com/opportunities/")).toBeNull();
    expect(instahyreJobIdFromUrl("not a url at all")).toBeNull();
  });
});
