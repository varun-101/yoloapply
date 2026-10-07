import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiUserError } from "../auth";
import { canonicalizeJobUrl } from "../jobs/url";
import { ingestJob } from "../application-agent/ingest";
import { initializeApplicationWorkflow, recordApplicationEvent } from "../application-agent/workflow";
import { deriveSubmissionState, SUBMITTED_EVENT, UNCONFIRMED_EVENT } from "../application-agent/submission";
import { loadApplicationIndex } from "./jobSearch";
import type { DuplicateMatch } from "./jobIdentity";

// Tracker reads and draft creation for agents. Drafts are bookkeeping only:
// creating one never contacts an employer.

const TRACKING_EVENTS = [SUBMITTED_EVENT, UNCONFIRMED_EVENT];

export async function checkDuplicate(
  userId: string,
  input: { url?: string; company?: string; role?: string }
) {
  const index = await loadApplicationIndex(userId);
  const matches = index.match({ urls: [input.url], company: input.company, role: input.role });
  const ids = matches.map((m) => m.applicationId);
  const events = ids.length
    ? await prisma.event.findMany({
        where: { applicationId: { in: ids }, type: { in: TRACKING_EVENTS } },
        select: { applicationId: true, type: true, createdAt: true },
      })
    : [];
  return {
    duplicate: matches.some((m) => m.reason !== "company_role"),
    possibleDuplicate: matches.length > 0,
    matches: matches.map((m) => ({
      ...m,
      submissionState: deriveSubmissionState(
        m.status,
        events.filter((e) => e.applicationId === m.applicationId)
      ),
    })),
    note:
      "canonical_url/posting_id = same posting. company_role = same company and title; may be a re-opened or multi-location posting, so read both before deciding.",
  };
}

export async function createDraft(
  userId: string,
  input:
    | { jobId: string; allowCompanyRoleMatch: boolean }
    | { url: string; company?: string; role?: string; location?: string; jobDescription?: string; allowCompanyRoleMatch: boolean }
) {
  const index = await loadApplicationIndex(userId);
  const decide = (matches: DuplicateMatch[]) => {
    const exact = matches.find((m) => m.reason !== "company_role");
    if (exact) return { existing: exact };
    if (matches.length && !input.allowCompanyRoleMatch) return { blocked: matches };
    return null;
  };

  if ("jobId" in input) {
    const lead = await prisma.jobLead.findUnique({ where: { id: input.jobId } });
    if (!lead) throw new ApiUserError("Job not found.", 404, "not_found");
    const overlay = await prisma.userLead.findUnique({
      where: { userId_jobLeadId: { userId, jobLeadId: lead.id } },
    });
    if (overlay?.applicationId) {
      const owned = await prisma.application.findFirst({ where: { id: overlay.applicationId, userId }, select: { id: true, status: true } });
      if (owned) return { created: false, deduplicated: true, applicationId: owned.id, status: owned.status, reason: "already_promoted" };
    }
    const verdict = decide(index.match({ urls: [lead.url, lead.canonicalUrl], company: lead.company, role: lead.role }));
    if (verdict && "existing" in verdict && verdict.existing) {
      return { created: false, deduplicated: true, applicationId: verdict.existing.applicationId, status: verdict.existing.status, reason: verdict.existing.reason };
    }
    if (verdict && "blocked" in verdict) {
      return {
        created: false,
        deduplicated: false,
        possibleDuplicates: verdict.blocked,
        reason: "company_role_match",
        hint: "Same company and title already tracked. Check it; pass allowCompanyRoleMatch=true only if this is a different posting.",
      };
    }
    const canonicalUrl = canonicalizeJobUrl(lead.url) ?? lead.canonicalUrl ?? null;
    try {
      const app = await prisma.application.create({
        data: {
          userId,
          company: lead.company,
          role: lead.role,
          source: lead.source,
          jdUrl: lead.url ?? null,
          canonicalUrl,
          jdText: lead.jdText ?? null,
          applyUrl: lead.url ?? null,
          location: lead.location ?? null,
          notes:
            [
              lead.salary ? `Listed salary (unverified): ${lead.salary}` : null,
              lead.experience ? `Experience: ${lead.experience}` : null,
              lead.skills ? `Skills: ${lead.skills}` : null,
            ]
              .filter(Boolean)
              .join("\n") || null,
          status: "draft",
        },
      });
      await initializeApplicationWorkflow(app.id, { hasJobDescription: (lead.jdText ?? "").trim().length >= 50 });
      await recordApplicationEvent(app.id, "status_change", `draft (promoted from ${lead.source} discovery via MCP)`);
      await prisma.userLead.upsert({
        where: { userId_jobLeadId: { userId, jobLeadId: lead.id } },
        create: { userId, jobLeadId: lead.id, status: "promoted", applicationId: app.id },
        update: { status: "promoted", applicationId: app.id },
      });
      return { created: true, deduplicated: false, applicationId: app.id, status: app.status };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && canonicalUrl) {
        const existing = await prisma.application.findUniqueOrThrow({
          where: { userId_canonicalUrl: { userId, canonicalUrl } },
          select: { id: true, status: true },
        });
        return { created: false, deduplicated: true, applicationId: existing.id, status: existing.status, reason: "canonical_url" };
      }
      throw error;
    }
  }

  const verdict = decide(index.match({ urls: [input.url], company: input.company, role: input.role }));
  if (verdict && "existing" in verdict && verdict.existing) {
    return { created: false, deduplicated: true, applicationId: verdict.existing.applicationId, status: verdict.existing.status, reason: verdict.existing.reason };
  }
  if (verdict && "blocked" in verdict) {
    return {
      created: false,
      deduplicated: false,
      possibleDuplicates: verdict.blocked,
      reason: "company_role_match",
      hint: "Same company and title already tracked. Check it; pass allowCompanyRoleMatch=true only if this is a different posting.",
    };
  }
  const result = await ingestJob(userId, {
    url: input.url,
    company: input.company,
    role: input.role,
    location: input.location,
    jdText: input.jobDescription,
    source: "mcp",
  });
  return {
    created: !result.deduplicated,
    deduplicated: result.deduplicated,
    applicationId: result.application.id,
    status: result.application.status,
  };
}

export async function listApplications(
  userId: string,
  input: { statuses?: string[]; company?: string; limit: number; cursor?: string }
) {
  let after: { at: Date; id: string } | null = null;
  if (input.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as { at: string; id: string };
      after = { at: new Date(parsed.at), id: String(parsed.id) };
      if (Number.isNaN(after.at.getTime())) throw new Error();
    } catch {
      throw new ApiUserError("Invalid cursor. Start again without a cursor.", 400, "invalid_cursor");
    }
  }
  const where: Prisma.ApplicationWhereInput = {
    userId,
    ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
    ...(input.company ? { company: { contains: input.company, mode: "insensitive" } } : {}),
    ...(after ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] } : {}),
  };
  const rows = await prisma.application.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true,
      company: true,
      role: true,
      status: true,
      location: true,
      appliedAt: true,
      createdAt: true,
      jdUrl: true,
      applyUrl: true,
      personalizeStatus: true,
      files: { where: { kind: "resume_pdf" }, select: { updatedAt: true } },
      events: { where: { type: { in: TRACKING_EVENTS } }, select: { type: true, createdAt: true } },
    },
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    applications: page.map((a) => ({
      applicationId: a.id,
      company: a.company,
      role: a.role,
      status: a.status,
      submissionState: deriveSubmissionState(a.status, a.events),
      appliedAt: a.appliedAt,
      createdAt: a.createdAt,
      location: a.location,
      url: a.applyUrl ?? a.jdUrl,
      resumeReady: a.files.length > 0,
      resumeGenerating: a.personalizeStatus === "running",
    })),
    nextCursor:
      rows.length > input.limit && last
        ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString("base64url")
        : null,
  };
}

export async function getApplicationDetail(userId: string, applicationId: string) {
  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 60 },
      tasks: true,
      analysis: true,
      files: { select: { id: true, kind: true, filename: true, size: true, updatedAt: true } },
    },
  });
  if (!app) throw new ApiUserError("Application not found.", 404, "not_found");
  // Submission state from ALL tracking events, not just the recent page.
  const tracking = await prisma.event.findMany({
    where: { applicationId: app.id, type: { in: TRACKING_EVENTS } },
    select: { type: true, createdAt: true },
  });
  const { events, rawJdText: _raw, ...rest } = app;
  void _raw;
  const cap = (v: string | null, n: number) => (v && v.length > n ? v.slice(0, n) + " [truncated]" : v);
  return {
    ...rest,
    jdText: cap(rest.jdText, 30_000),
    notes: cap(rest.notes, 5_000),
    coverLetterText: cap(rest.coverLetterText, 10_000),
    submissionState: deriveSubmissionState(app.status, tracking),
    events: events.map((e) => {
      const meta = e.metadata == null ? null : JSON.stringify(e.metadata);
      return {
        type: e.type,
        detail: cap(e.detail, 1_000),
        metadata: meta && meta.length > 2_000 ? { truncated: true, preview: meta.slice(0, 2_000) } : e.metadata,
        createdAt: e.createdAt,
      };
    }),
  };
}
