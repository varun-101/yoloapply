import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "@/lib/db";
import { generateExtensionToken } from "@/lib/credentials";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { handleMcpPost, MAX_BODY_BYTES } from "@/lib/mcp/http";
import { TOOL_NAMES, isReceiptFor } from "@/lib/mcp/server";
import { getMicrosoftAccessToken } from "@/lib/microsoft/oauth";
import { getApplicationOtp, getApplicationEmail, searchApplicationEmails, type GraphFetch } from "@/lib/mcp/mail/service";
import { PATCH as patchApplication } from "@/app/api/applications/[id]/route";

// Integration tests on the disposable database: the real HTTP handler, the
// real SDK client over an in-process fetch, real Prisma queries.

const BASE = "http://127.0.0.1:3999";
let tokenA = "";
let tokenB = "";
let userA = "";
let userB = "";
let appA = "";
let appB = "";

async function post(body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return handleMcpPost(
    new NextRequest(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: raw,
    })
  );
}

const inProcessFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const req = new NextRequest(typeof input === "string" || input instanceof URL ? input.toString() : input.url, init as never);
  if (req.method !== "POST") return new Response(null, { status: 405 });
  return handleMcpPost(req);
}) as typeof fetch;

async function client(token: string) {
  const c = new Client({ name: "yoloapply-test", version: "1.0.0" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
      fetch: inProcessFetch,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  return c;
}

type ToolResult = { structuredContent?: unknown; content?: unknown; isError?: boolean };

function structured<T = Record<string, unknown>>(raw: unknown): T {
  const r = raw as ToolResult;
  if (r.isError) throw new Error(`tool error: ${JSON.stringify(r.content)}`);
  return r.structuredContent as T;
}

function errorCode(raw: unknown): string {
  const r = raw as ToolResult;
  expect(r.isError).toBe(true);
  return JSON.parse((r.content as { text: string }[])[0].text).code;
}

const LEVER_UUID = "4524ca30-d006-48bc-81c2-cec58e1bb331";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Event","ApplicationTask","StoredFile","UserLead","JobLead","Application","UserCredential","UserProfile","UserPromptSetting","Project","User" CASCADE`
  );
  const a = await prisma.user.create({ data: { email: "a@test.local" } });
  const b = await prisma.user.create({ data: { email: "b@test.local" } });
  userA = a.id;
  userB = b.id;
  for (const [u, name] of [[a.id, "Asha Rao"], [b.id, "Bilal Khan"]] as const) {
    await prisma.userProfile.create({
      data: {
        userId: u,
        name,
        email: `${name.split(" ")[0].toLowerCase()}@test.local`,
        city: "Pune",
        country: "India",
        experience: [{ title: "Intern", company: "Loan for India", period: "2025-2026", bullets: [] }],
        applicationAnswers: {
          consentPreferences: { smsMessages: "yes" },
          declarationDefaults:
            u === a.id
              ? {
                  priorEmploymentAtHiringCompany: { answer: "No", confirmedAt: "2026-10-07", confirmedBy: "candidate" },
                  relativeInGovernment: { answer: "No", confirmedAt: "2026-10-07", confirmedBy: "candidate" },
                }
              : undefined,
        },
      },
    });
  }
  await prisma.userPromptSetting.create({ data: { userId: a.id, answers: "Minimum 10 LPA; currently freelancing." } });
  tokenA = await generateExtensionToken(a.id);
  tokenB = await generateExtensionToken(b.id);

  appA = (
    await prisma.application.create({
      data: {
        userId: a.id,
        company: "Acme",
        role: "Backend Engineer",
        source: "lever",
        status: "personalized",
        jdUrl: `https://jobs.lever.co/acme/${LEVER_UUID}`,
        applyUrl: `https://jobs.lever.co/acme/${LEVER_UUID}/apply`,
        jdText: "x".repeat(200),
      },
    })
  ).id;
  appB = (
    await prisma.application.create({
      data: { userId: b.id, company: "Globex", role: "SDE Intern", source: "manual", status: "draft" },
    })
  ).id;
  await prisma.application.create({
    data: { userId: a.id, company: "Initech Pvt Ltd", role: "Software Engineer I", source: "manual", status: "applied", appliedAt: new Date("2026-09-01") },
  });

  // 130 catalog rows: every third undated, mixed sources, two duplicates of A's applications.
  const base = Date.parse("2026-10-01T00:00:00Z");
  const rows = Array.from({ length: 130 }, (_, i) => ({
    source: ["greenhouse", "lever", "instahyre", "sheet", "ashby"][i % 5],
    externalId: `ext-${i}`,
    company: `Company ${i}`,
    role: i % 7 === 0 ? "Senior Staff Engineer" : "Software Engineer",
    location: i % 4 === 0 ? "Remote" : i % 4 === 1 ? "Pune, India" : "Bengaluru",
    url: `https://example.com/jobs/${i}`,
    canonicalUrl: `https://example.com/jobs/${i}`,
    experience: i % 6 === 0 ? "3-5 years" : i % 6 === 1 ? "0-1 years" : null,
    postedAt: i % 3 === 0 ? null : new Date(base - i * 3_600_000),
    createdAt: new Date(base - i * 1_800_000),
  }));
  rows.push({
    source: "lever",
    externalId: "dup-posting",
    company: "Acme",
    role: "Backend Engineer (Platform)",
    location: "Pune",
    url: `https://jobs.lever.co/acme/${LEVER_UUID}?lever-source=agg`,
    canonicalUrl: `https://jobs.lever.co/acme/${LEVER_UUID}?lever-source=agg`,
    experience: null,
    postedAt: new Date(base),
    createdAt: new Date(base),
  });
  rows.push({
    source: "sheet",
    externalId: "dup-company-role",
    company: "INITECH",
    role: "Software Engineer - I",
    location: "Pune",
    url: "https://other-board.example/initech/123",
    canonicalUrl: "https://other-board.example/initech/123",
    experience: null,
    postedAt: null,
    createdAt: new Date(base),
  });
  await prisma.jobLead.createMany({ data: rows });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("transport and auth", () => {
  it("rejects missing, malformed and invalid tokens", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await post(init)).status).toBe(401);
    expect((await post(init, { authorization: "Bearer sk-not-ours" })).status).toBe(401);
    const bad = await post(init, { authorization: "Bearer yolo_" + "a".repeat(32) });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain("Bearer");
  });
  it("bounds request bodies and rejects bad JSON", async () => {
    const auth = { authorization: `Bearer ${tokenA}` };
    expect((await post("{not json", auth)).status).toBe(400);
    const huge = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(MAX_BODY_BYTES) } });
    expect((await post(huge, auth)).status).toBe(413);
  });
  it("initializes with the official SDK client and lists exactly the tools", async () => {
    const c = await client(tokenA);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) expect(t.annotations?.destructiveHint).toBe(false);
    expect(tools.map((t) => t.name).some((n) => /submit_application|send|delete/.test(n))).toBe(false);
    await c.close();
  });
});

describe("tenant isolation", () => {
  it("hides other users' applications behind not_found", async () => {
    const c = await client(tokenA);
    for (const [name, args] of [
      ["get_application", { applicationId: appB }],
      ["get_resume_status", { applicationId: appB }],
      ["get_resume_file", { applicationId: appB }],
      ["record_application_attempt", { applicationId: appB, stage: "form_opened", outcome: "ok" }],
      ["record_confirmed_submission", { applicationId: appB, evidenceKind: "site_confirmation", confirmationText: "Thanks" }],
      ["prepare_resume", { applicationId: appB }],
    ] as const) {
      expect(errorCode(await c.callTool({ name, arguments: args }))).toBe("not_found");
    }
    const listed = structured<{ applications: { applicationId: string }[] }>(await c.callTool({ name: "list_applications", arguments: {} }));
    expect(listed.applications.map((a) => a.applicationId)).not.toContain(appB);
    const untouched = await prisma.application.findUniqueOrThrow({ where: { id: appB } });
    expect(untouched.status).toBe("draft");
    expect(await prisma.event.count({ where: { applicationId: appB } })).toBe(0);
    await c.close();
  });
  it("keeps declaration defaults per candidate", async () => {
    const ca = await client(tokenA);
    const cb = await client(tokenB);
    const ctxA = structured<{ declarations: { resolved: { status: string }[] }; answerPreferences: { text: string } }>(
      await ca.callTool({ name: "get_application_context", arguments: { company: "Acme" } })
    );
    const ctxB = structured<{ declarations: { resolved: { status: string }[] }; answerPreferences: { text: string | null } }>(
      await cb.callTool({ name: "get_application_context", arguments: { company: "Acme" } })
    );
    expect(ctxA.declarations.resolved.map((d) => d.status)).toEqual(["answer", "answer"]);
    expect(ctxB.declarations.resolved.map((d) => d.status)).toEqual(["unknown", "unknown"]);
    expect(ctxA.answerPreferences.text).toContain("10 LPA");
    expect(ctxB.answerPreferences.text).toBeNull();
    await ca.close();
    await cb.close();
  });
});

describe("search_jobs", () => {
  type Page = { jobs: { jobId: string; company: string; sources: string[]; dateBasis: string; tracking: { possibleDuplicates: unknown[] } }[]; nextCursor: string | null };
  it("pages through every row exactly once, undated rows included, duplicates excluded", async () => {
    const c = await client(tokenA);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = structured<Page>(await c.callTool({ name: "search_jobs", arguments: { limit: 25, ...(cursor ? { cursor } : {}) } }));
      seen.push(...page.jobs.map((j) => j.jobId));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 20);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(130); // 132 rows minus the posting-id and company+role duplicates
    const leads = await prisma.jobLead.findMany({ where: { id: { in: seen } }, select: { postedAt: true, company: true } });
    expect(leads.filter((l) => !l.postedAt).length).toBe(44);
    expect(leads.some((l) => l.company === "Acme" || l.company === "INITECH")).toBe(false);
    await c.close();
  });
  it("is stable when new rows arrive between pages", async () => {
    const c = await client(tokenA);
    const first = structured<Page>(await c.callTool({ name: "search_jobs", arguments: { limit: 10 } }));
    await prisma.jobLead.create({
      data: { source: "greenhouse", externalId: "late", company: "Late Co", role: "Engineer", postedAt: new Date(), url: "https://late.example/1" },
    });
    const second = structured<Page>(await c.callTool({ name: "search_jobs", arguments: { limit: 10, cursor: first.nextCursor! } }));
    expect(second.jobs.some((j) => first.jobs.some((f) => f.jobId === j.jobId))).toBe(false);
    expect(second.jobs.some((j) => j.company === "Late Co")).toBe(false);
    await c.close();
  });
  it("filters by source, location and experience, and flags duplicates on request", async () => {
    const c = await client(tokenA);
    const page = structured<Page & { jobs: { sources: string[] }[] }>(
      await c.callTool({ name: "search_jobs", arguments: { sources: ["instahyre"], locations: ["pune"], maxYearsExperience: 1, limit: 50 } })
    );
    expect(page.jobs.length).toBeGreaterThan(0);
    expect(page.jobs.every((j) => j.sources.includes("instahyre"))).toBe(true);
    const flagged = structured<Page>(
      await c.callTool({ name: "search_jobs", arguments: { companies: ["acme", "initech"], duplicatePolicy: "flag", limit: 10 } })
    );
    expect(flagged.jobs.length).toBe(2);
    expect(flagged.jobs.every((j) => j.tracking.possibleDuplicates.length === 1)).toBe(true);
    const summary = structured<{ sources: { source: string; total: number; undated: number }[] }>(
      await c.callTool({ name: "get_job_source_summary", arguments: {} })
    );
    expect(summary.sources.reduce((n, s) => n + s.total, 0)).toBeGreaterThanOrEqual(131);
    await c.close();
  });
});

describe("tracking", () => {
  it("records an unknown submit as an attempt, never as applied", async () => {
    const c = await client(tokenA);
    const r = structured<{ guidance: string }>(
      await c.callTool({ name: "record_application_attempt", arguments: { applicationId: appA, stage: "submit_clicked", outcome: "unknown" } })
    );
    expect(r.guidance).toMatch(/UNKNOWN/);
    const detail = structured<{ status: string; submissionState: string }>(await c.callTool({ name: "get_application", arguments: { applicationId: appA } }));
    expect(detail).toMatchObject({ status: "personalized", submissionState: "unconfirmed_attempt" });
    await c.close();
  });
  it("records one submission under concurrent confirmations", async () => {
    const c = await client(tokenA);
    const calls = Array.from({ length: 5 }, () =>
      c.callTool({
        name: "record_confirmed_submission",
        arguments: { applicationId: appA, evidenceKind: "site_confirmation", confirmationText: "Application submitted!", pageUrl: "https://jobs.lever.co/acme/x/thanks" },
      })
    );
    const results = (await Promise.all(calls)).map((r) => structured<{ alreadyRecorded: boolean }>(r));
    expect(results.filter((r) => !r.alreadyRecorded)).toHaveLength(1);
    expect(await prisma.event.count({ where: { applicationId: appA, type: "APPLICATION_SUBMITTED" } })).toBe(1);
    const app = await prisma.application.findUniqueOrThrow({ where: { id: appA } });
    expect(app.status).toBe("applied");
    expect(app.appliedAt).not.toBeNull();
    await c.close();
  });
  it("reconciles an employer duplicate notice to the original date", async () => {
    const c = await client(tokenA);
    const original = "2026-08-15T06:30:00.000Z";
    const r = structured<{ appliedAt: string; appliedAtCorrected: boolean }>(
      await c.callTool({
        name: "record_confirmed_submission",
        arguments: {
          applicationId: appA,
          evidenceKind: "employer_duplicate_notice",
          originalSubmittedAt: original,
          originalSubmittedAtSource: "Employer portal shows application dated 15 Aug 2026",
        },
      })
    );
    // Unverified by a receipt: recorded as evidence but never pulls the date earlier.
    expect(r.appliedAtCorrected).toBe(false);
    expect(r.appliedAt).not.toBe(original);
    expect(await prisma.event.count({ where: { applicationId: appA, type: "APPLICATION_SUBMITTED" } })).toBe(1);
    await c.close();
  });
  it("keeps submission state confirmed past the recent-events page", async () => {
    await prisma.event.createMany({
      data: Array.from({ length: 70 }, (_, i) => ({ applicationId: appA, type: "APPLICATION_ATTEMPT", detail: `noise ${i}` })),
    });
    const c = await client(tokenA);
    const detail = structured<{ submissionState: string }>(await c.callTool({ name: "get_application", arguments: { applicationId: appA } }));
    expect(detail.submissionState).toBe("confirmed");
    await c.close();
  });
  it("PATCH keeps or sets appliedAt correctly", async () => {
    const app = await prisma.application.create({
      data: { userId: userA, company: "Hooli", role: "SWE", source: "manual", status: "applied", appliedAt: new Date("2026-09-10T00:00:00Z") },
    });
    const patch = (body: unknown) =>
      patchApplication(
        new NextRequest(`${BASE}/api/applications/${app.id}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: { id: app.id } }
      );
    expect((await patch({ status: "applied" })).status).toBe(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).appliedAt?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect((await patch({ status: "applied", appliedAt: "2026-09-05T08:00:00.000Z" })).status).toBe(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).appliedAt?.toISOString()).toBe("2026-09-05T08:00:00.000Z");
    expect((await patch({ appliedAt: "2999-01-01T00:00:00Z" })).status).toBe(400);
    const otherUsers = patchApplication(
      new NextRequest(`${BASE}/api/applications/${app.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${tokenB}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      }),
      { params: { id: app.id } }
    );
    expect((await otherUsers).status).toBe(404);
  });
  it("creates drafts once and blocks company+role lookalikes", async () => {
    const c = await client(tokenA);
    const lead = await prisma.jobLead.findFirstOrThrow({ where: { externalId: "ext-5" } });
    const first = structured<{ created: boolean; applicationId: string }>(await c.callTool({ name: "create_application_draft", arguments: { jobId: lead.id } }));
    const again = structured<{ created: boolean; applicationId: string; deduplicated: boolean }>(
      await c.callTool({ name: "create_application_draft", arguments: { jobId: lead.id } })
    );
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, deduplicated: true, applicationId: first.applicationId });
    const lookalike = await prisma.jobLead.findFirstOrThrow({ where: { externalId: "dup-company-role" } });
    const blocked = structured<{ created: boolean; reason: string }>(await c.callTool({ name: "create_application_draft", arguments: { jobId: lookalike.id } }));
    expect(blocked).toMatchObject({ created: false, reason: "company_role_match" });
    await c.close();
  });
  it("reports resume preconditions synchronously", async () => {
    const c = await client(tokenA);
    expect(errorCode(await c.callTool({ name: "get_resume_file", arguments: { applicationId: appA } }))).toBe("no_resume");
    expect(errorCode(await c.callTool({ name: "prepare_resume", arguments: { applicationId: appA } }))).toBe("no_llm_key");
    const status = structured<{ status: string }>(await c.callTool({ name: "get_resume_status", arguments: { applicationId: appA } }));
    expect(status.status).toBe("idle");
    await c.close();
  });
});

describe("mail", () => {
  const mailbox = "asha@outlook.test";
  let otpApp = "";
  let otherApp = "";

  beforeAll(async () => {
    await prisma.userCredential.update({
      where: { userId: userA },
      data: { msRefreshTokenEnc: encryptSecret("refresh-0"), msEmail: mailbox, msScopes: "User.Read Mail.Send Mail.Read" },
    });
    otpApp = (
      await prisma.application.create({
        data: { userId: userA, company: "Umbrella", role: "SDE", source: "greenhouse", status: "draft", applyUrl: "https://job-boards.greenhouse.io/umbrella/jobs/1" },
      })
    ).id;
    otherApp = (
      await prisma.application.create({ data: { userId: userA, company: "Umbrella Labs", role: "SDE II", source: "greenhouse", status: "draft" } })
    ).id;
  });

  function fakeGraph(messages: Record<string, unknown>[]): GraphFetch {
    return async (path) => {
      if (path.startsWith("/me/messages?")) return { value: messages };
      const id = decodeURIComponent(path.split("/me/messages/")[1].split("?")[0]);
      const m = messages.find((x) => x.id === id);
      if (!m) throw new Error("not found");
      return { ...m, body: { contentType: "text", content: m.bodyPreview } };
    };
  }

  function graphMessage(id: string, subject: string, body: string, minutesAgo: number, from = "no-reply@us.greenhouse-mail.io") {
    return {
      id,
      subject,
      bodyPreview: body,
      from: { emailAddress: { address: from, name: "Umbrella Hiring" } },
      toRecipients: [{ emailAddress: { address: mailbox } }],
      receivedDateTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    };
  }

  it("releases a bound code once, never for another application", async () => {
    const msgs = [
      graphMessage("AAMkOTP000000001", "Umbrella security code", "Your security code is 482913 to finish your application to Umbrella.", 1),
      graphMessage("AAMkBANK00000001", "OTP for transaction", "OTP 111111 for your debit card transaction", 1, "alerts@bank.test"),
    ];
    const requestedAt = new Date(Date.now() - 2 * 60_000);
    const r = await getApplicationOtp(userA, { applicationId: otpApp, requestedAt }, fakeGraph(msgs));
    expect(r).toMatchObject({ kind: "code", code: "482913" });
    const event = await prisma.event.findFirstOrThrow({ where: { applicationId: otpApp, type: "MAILBOX_OTP_READ" } });
    expect(JSON.stringify(event)).not.toContain("482913");
    const reuse = await getApplicationOtp(userA, { applicationId: otherApp, requestedAt }, fakeGraph(msgs));
    expect(reuse.kind).toBe("none");
    await expect(
      getApplicationOtp(userA, { applicationId: appA, requestedAt }, fakeGraph(msgs))
    ).rejects.toMatchObject({ code: "application_not_active" });
    await expect(
      getApplicationOtp(userA, { applicationId: appB, requestedAt }, fakeGraph(msgs))
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("searches receipts with original received time and refuses unrelated mail", async () => {
    const receipt = graphMessage("AAMkRECEIPT00001", "Thank you for applying to Umbrella", "We have received your application for SDE.", 600);
    const promo = graphMessage("AAMkPROMO0000001", "Big sale", "50% off, unsubscribe", 5, "deals@shop.test");
    const res = await searchApplicationEmails(userA, { includeUnmatched: false, limit: 10 }, fakeGraph([receipt, promo]));
    expect(res.messages.map((m) => m.messageId)).toEqual(["AAMkRECEIPT00001"]);
    expect(res.messages[0].receivedAt).toBe(receipt.receivedDateTime);
    expect(res.messages[0].category).toBe("application_receipt");
    await expect(getApplicationEmail(userA, { messageId: "AAMkPROMO0000001" }, fakeGraph([promo]))).rejects.toMatchObject({
      code: "not_application_mail",
    });
  });
  it("credits a receipt only to the single best-matching application", async () => {
    const backend = (await prisma.application.create({ data: { userId: userA, company: "Stark", role: "Backend Engineer", source: "lever", status: "draft" } })).id;
    const frontend = (await prisma.application.create({ data: { userId: userA, company: "Stark", role: "Frontend Engineer", source: "lever", status: "draft" } })).id;
    const generic = graphMessage("AAMkSTARKGEN0001", "Thank you for applying to Stark", "We have received your application.", 30, "no-reply@hire.lever.co");
    const specific = graphMessage("AAMkSTARKBE00001", "Thank you for applying to Stark: Backend Engineer", "We have received your application.", 30, "no-reply@hire.lever.co");
    const g = await getApplicationEmail(userA, { messageId: generic.id, applicationId: frontend }, fakeGraph([generic]));
    expect(isReceiptFor(g, frontend)).toBe(false);
    expect(isReceiptFor(g, backend)).toBe(false);
    const sp = await getApplicationEmail(userA, { messageId: specific.id, applicationId: frontend }, fakeGraph([specific]));
    expect(isReceiptFor(sp, backend)).toBe(true);
    expect(isReceiptFor(sp, frontend)).toBe(false);
  });
  it("does not credit an old company-only receipt to a newly tracked role", async () => {
    const swe = (await prisma.application.create({ data: { userId: userA, company: "Oscorp", role: "Software Engineer", source: "lever", status: "draft" } })).id;
    const old = graphMessage("AAMkOSCORPOLD001", "Thank you for applying to Oscorp", "We have received your application.", 60 * 24 * 200, "no-reply@hire.lever.co");
    old.from.emailAddress.name = "Oscorp Talent";
    const mail = await getApplicationEmail(userA, { messageId: old.id, applicationId: swe }, fakeGraph([old]));
    expect(mail.matchConfidence).toBe("single");
    expect(isReceiptFor(mail, swe)).toBe(false);
  });
  it("releases one code once under concurrent requests for two applications", async () => {
    const a1 = (await prisma.application.create({ data: { userId: userA, company: "Wayne", role: "SDE", source: "greenhouse", status: "draft" } })).id;
    const a2 = (await prisma.application.create({ data: { userId: userA, company: "Wayne", role: "SDE II", source: "greenhouse", status: "draft" } })).id;
    const msgs = [graphMessage("AAMkWAYNEOTP0001", "Wayne security code", "Your security code is 735190 for your Wayne application.", 1)];
    const requestedAt = new Date(Date.now() - 2 * 60_000);
    const results = await Promise.all([
      getApplicationOtp(userA, { applicationId: a1, requestedAt }, fakeGraph(msgs)),
      getApplicationOtp(userA, { applicationId: a2, requestedAt }, fakeGraph(msgs)),
    ]);
    expect(results.filter((r) => r.kind === "code")).toHaveLength(1);
  });
  it("withholds the text of any message that mentions a code", async () => {
    const letters = graphMessage("AAMkLETTERS00001", "Security code for your application to Umbrella", "Copy and paste this code into the security code field: kQbRtZxW", 2);
    const res = await searchApplicationEmails(userA, { includeUnmatched: false, limit: 10, categories: ["verification_code", "other"] }, fakeGraph([letters]));
    expect(JSON.stringify(res)).not.toContain("kQbRtZxW");
    const read = await getApplicationEmail(userA, { messageId: letters.id }, fakeGraph([letters]));
    expect(JSON.stringify(read)).not.toContain("kQbRtZxW");
  });
  it("redacts codes from search results", async () => {
    const code = graphMessage("AAMkCODE00000001", "482913 is your Umbrella code", "Your security code is 482913 for Umbrella.", 2);
    const res = await searchApplicationEmails(userA, { includeUnmatched: false, limit: 10, categories: ["verification_code"] }, fakeGraph([code]));
    expect(res.messages).toHaveLength(1);
    expect(JSON.stringify(res.messages)).not.toContain("482913");
    expect(res.coverageComplete).toBe(true);
  });
  it("reports setup instructions when no mailbox is connected", async () => {
    const c = await client(tokenB);
    const conn = structured<{ connected: boolean; setup: string }>(await c.callTool({ name: "get_mail_connection", arguments: {} }));
    expect(conn.connected).toBe(false);
    expect(conn.setup).toMatch(/Connect Outlook/);
    expect(errorCode(await c.callTool({ name: "search_application_emails", arguments: {} }))).toBe("no_mailbox");
    await c.close();
  });
});

describe("Outlook refresh lease", () => {
  it("spends a rotating refresh token once across two processes", async () => {
    await prisma.userCredential.update({
      where: { userId: userA },
      data: { msRefreshTokenEnc: encryptSecret("refresh-1"), msAccessTokenEnc: null, msTokenExpiresAt: new Date(0) },
    });
    let calls = 0;
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("login.microsoftonline.com")) return realFetch(input, init);
      calls++;
      await new Promise((r) => setTimeout(r, 300));
      return new Response(JSON.stringify({ access_token: `access-${calls}`, refresh_token: `refresh-${calls + 1}`, expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const g = globalThis as unknown as { __msTokenRefresh?: Map<string, Promise<string>> };
    const first = getMicrosoftAccessToken(userA);
    g.__msTokenRefresh?.clear(); // a second process has its own in-memory map
    const second = getMicrosoftAccessToken(userA);
    const [t1, t2] = await Promise.all([first, second]);
    spy.mockRestore();
    expect(calls).toBe(1);
    expect(t1).toBe("access-1");
    expect(t2).toBe("access-1");
    const cred = await prisma.userCredential.findUniqueOrThrow({ where: { userId: userA } });
    expect(decryptSecret(cred.msRefreshTokenEnc!)).toBe("refresh-2");
    expect(cred.msRefreshLeaseOwner).toBeNull();
  });
});
