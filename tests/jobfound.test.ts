import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJobfoundLeads } from "@/lib/discovery/jobfound";

function job(overrides: Record<string, unknown> = {}) {
  return {
    $id: "job-1",
    title: "Software Test Engineer",
    companyName: "Data Eminence",
    description:
      "<p>Build and maintain reliable automated tests for web applications.</p><p>Work closely with engineers.</p>",
    jobType: "Contract",
    salary: "Competitive",
    experience: "0",
    domain: "Software Testing",
    location: null,
    country: "India",
    skills: "Playwright, SQL",
    applyUrl: "https://example.com/jobs/1",
    workplaceType: "remote",
    postedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJobfoundLeads", () => {
  it("uses the current REST API and maps its response fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ jobs: [job()], total: 1, page: 1, limit: 100, hasMore: false }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", request);

    const result = await fetchJobfoundLeads();

    expect(result.error).toBeUndefined();
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]).toMatchObject({
      source: "jobfound",
      externalId: "job-1",
      company: "Data Eminence",
      role: "Software Test Engineer",
      location: "Remote",
      url: "https://example.com/jobs/1",
      salary: "Competitive",
      jobType: "Contract",
      experience: "0",
      skills: "Playwright, SQL",
    });
    expect(result.leads[0].jdText).toContain("Build and maintain reliable automated tests");

    const requested = new URL(String(request.mock.calls[0][0]));
    expect(requested.origin + requested.pathname).toBe("https://jobfound.org/api/jobs");
    expect(Object.fromEntries(requested.searchParams)).toEqual({
      page: "1",
      limit: "100",
      sort: "newest",
      country: "India",
      postedWithin: "14",
    });
  });

  it("paginates while hasMore is true and stops at the local age cutoff", async () => {
    const recent = job({ $id: "recent" });
    const old = job({ $id: "old", postedAt: new Date(Date.now() - 15 * 86400 * 1000).toISOString() });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jobs: [recent], total: 2, page: 1, limit: 100, hasMore: true }))
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jobs: [old], total: 2, page: 2, limit: 100, hasMore: false }))
      );
    vi.stubGlobal("fetch", request);

    const result = await fetchJobfoundLeads();

    expect(result.leads.map((lead) => lead.externalId)).toEqual(["recent"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(new URL(String(request.mock.calls[1][0])).searchParams.get("page")).toBe("2");
  });

  it("returns a source error for HTTP and malformed-response failures", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(fetchJobfoundLeads()).resolves.toMatchObject({
      source: "jobfound",
      leads: [],
      error: "Jobfound returned HTTP 503",
    });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [] }))));
    await expect(fetchJobfoundLeads()).resolves.toMatchObject({
      source: "jobfound",
      leads: [],
      error: "Jobfound returned an invalid jobs response",
    });
  });
});
