import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isBoardHost,
  isGenericHost,
  registrableDomain,
  domainFromUrl,
  resolveCompanyDomain,
} from "@/lib/contacts/domain";

describe("isBoardHost", () => {
  it("flags ATS / job-board hosts and their subdomains", () => {
    expect(isBoardHost("boards.greenhouse.io")).toBe(true);
    expect(isBoardHost("jobs.lever.co")).toBe(true);
    expect(isBoardHost("linkedin.com")).toBe(true);
    expect(isBoardHost("www.indeed.com")).toBe(true);
  });

  it("does not flag a real company host", () => {
    expect(isBoardHost("acme.com")).toBe(false);
    expect(isBoardHost("careers.acme.io")).toBe(false);
  });
});

describe("isGenericHost", () => {
  it("flags consumer mail providers", () => {
    expect(isGenericHost("gmail.com")).toBe(true);
    expect(isGenericHost("www.outlook.com")).toBe(true);
  });

  it("does not flag a company host", () => {
    expect(isGenericHost("acme.com")).toBe(false);
  });
});

describe("registrableDomain", () => {
  it("drops www and leading subdomains", () => {
    expect(registrableDomain("www.acme.com")).toBe("acme.com");
    expect(registrableDomain("careers.acme.com")).toBe("acme.com");
    expect(registrableDomain("jobs.eng.acme.com")).toBe("acme.com");
  });

  it("preserves two-level public suffixes", () => {
    expect(registrableDomain("careers.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("acme.co.in")).toBe("acme.co.in");
  });

  it("leaves a bare registrable domain untouched", () => {
    expect(registrableDomain("acme.com")).toBe("acme.com");
  });
});

describe("domainFromUrl", () => {
  it("extracts a company domain from a real company URL", () => {
    expect(domainFromUrl("https://careers.acme.com/jobs/42")).toBe("acme.com");
    expect(domainFromUrl("acme.com/about")).toBe("acme.com");
  });

  it("returns null for board and generic hosts", () => {
    expect(domainFromUrl("https://boards.greenhouse.io/acme")).toBeNull();
    expect(domainFromUrl("https://mail.google.com")).toBeNull();
    expect(domainFromUrl("https://gmail.com")).toBeNull();
  });

  it("returns null for empty or invalid input", () => {
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl(undefined)).toBeNull();
    expect(domainFromUrl("http://")).toBeNull();
  });
});

describe("resolveCompanyDomain", () => {
  // Stub the Clearbit name lookup so the suite stays offline.
  function stubClearbit(suggestions: { name: string; domain: string }[] | null) {
    vi.stubGlobal("fetch", async () =>
      suggestions
        ? ({ ok: true, json: async () => suggestions } as Response)
        : ({ ok: false, json: async () => [] } as Response)
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  it("prefers a real company URL over the name lookup", async () => {
    stubClearbit([{ name: "Acme", domain: "wrong.com" }]);
    expect(await resolveCompanyDomain({ company: "Acme", urls: ["https://careers.acme.com/1"] })).toEqual({
      domain: "acme.com",
      via: "url",
    });
  });

  it("falls back to the name lookup when every URL is a job board", async () => {
    stubClearbit([{ name: "Acme", domain: "acme.com" }]);
    expect(
      await resolveCompanyDomain({ company: "Acme", urls: ["https://www.instahyre.com/job-1-sde-at-acme/"] })
    ).toEqual({ domain: "acme.com", via: "name" });
  });

  // A board-reported company site is often a careers/hiring domain
  // (amazon.jobs), so it must not outrank Clearbit's primary domain.
  it("uses a fallback URL only after the name lookup fails", async () => {
    stubClearbit([{ name: "Amazon", domain: "amazon.com" }]);
    expect(
      await resolveCompanyDomain({ company: "Amazon", fallbackUrls: ["http://www.amazon.jobs/"] })
    ).toEqual({ domain: "amazon.com", via: "name" });

    stubClearbit(null);
    expect(
      await resolveCompanyDomain({ company: "Amazon", fallbackUrls: ["http://www.amazon.jobs/"] })
    ).toEqual({ domain: "amazon.jobs", via: "url" });
  });

  it("reports no domain when nothing resolves", async () => {
    stubClearbit(null);
    expect(await resolveCompanyDomain({ company: "Nowhere Ltd", urls: [null, "linkedin.com/jobs/1"] })).toEqual({
      domain: null,
      via: "none",
    });
  });
});
