import { describe, it, expect } from "vitest";
import {
  isBoardHost,
  isGenericHost,
  registrableDomain,
  domainFromUrl,
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
