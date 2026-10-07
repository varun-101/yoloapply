import { createHash } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { prisma } from "../db";
import { ApiAuthError, ApiUserError } from "../auth";
import { getSetupStatus } from "../setup";
import { getFile } from "../files";
import { getProfileOrNull } from "../profile";
import { detectAtsProvider } from "../application-agent/preparation";
import {
  recordApplicationAttempt,
  recordConfirmedSubmission,
  type ConfirmedSubmissionInput,
} from "../application-agent/submission";
import { getResumeStatus, startResumeGeneration } from "../application-agent/resumeJob";
import { refreshLeadJd } from "../discovery/leadJd";
import { SOURCE_LABEL } from "../discovery/types";
import { getApplicationContext } from "./context";
import { searchJobs, sourceSummary, loadApplicationIndex, type JobSearchFilters } from "./jobSearch";
import { describeSalary, jdQuality } from "./jobIdentity";
import { checkDuplicate, createDraft, getApplicationDetail, listApplications } from "./applications";
import { reviewFields } from "./formReview";
import { readDeclarationDefaults } from "./declarations";
import { playbook } from "./playbook";
import {
  getApplicationEmail,
  getApplicationOtp,
  mailConnection,
  searchApplicationEmails,
} from "./mail/service";

// The YOLOapply MCP server: discovery, candidate context, resume artifacts,
// application tracking and read-only application mail for agents that fill
// employer forms in a collaborative browser. Deliberately absent: any tool
// that submits to an employer, sends email, deletes data, or changes
// credentials. One instance per request (stateless HTTP), scoped to one user.

export interface McpContext {
  userId: string;
  baseUrl: string;
}

export const SERVER_INFO = { name: "yoloapply", version: "1.0.0" };

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 200_000;
const MAX_FILE_CHUNK = 48 * 1024;

const id = z.string().trim().min(1).max(200);
const shortText = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO 8601 date-time");

export class ToolTimeoutError extends Error {}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ToolTimeoutError(`${label} did not finish within ${Math.round(ms / 1000)}s. It may still complete server-side; check status before retrying.`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function errorResult(message: string, code: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message, code }) }],
  };
}

/** Maps any thrown error to an actionable tool error. Unknown errors are not echoed verbatim. */
export function toToolError(e: unknown): CallToolResult {
  if (e instanceof ApiUserError) return errorResult(e.message, e.code ?? `http_${e.status}`);
  if (e instanceof ApiAuthError) return errorResult(e.message, "unauthorized");
  if (e instanceof ToolTimeoutError) return errorResult(e.message, "timeout");
  const message = e instanceof Error ? e.message : String(e);
  // Prisma and network errors can carry connection strings or internals.
  const safe = /postgres|prisma|password|secret|token|key=/i.test(message)
    ? "Internal error while processing the request."
    : message.slice(0, 300);
  return errorResult(safe, "internal_error");
}

/** A receipt counts only if it is a receipt AND this application is its sole best match. */
export function isReceiptFor(
  mail: { category: string; matchConfidence: string; matches: { applicationId: string; signals: string[] }[] },
  applicationId: string,
  opts: { requireRole?: boolean } = {}
): boolean {
  const top = mail.matches[0];
  if (mail.category !== "application_receipt" || mail.matchConfidence !== "single" || top?.applicationId !== applicationId) {
    return false;
  }
  // A company-only match from before tracking started may be an older
  // application to a different role at the same employer.
  const role = top.signals.includes("role_in_text") || top.signals.includes("partial_role_in_text");
  return opts.requireRole ? role : role || top.signals.includes("after_tracking_started");
}

export function jsonResult(summary: string, value: unknown): CallToolResult {
  const text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  if (text.length > MAX_OUTPUT_CHARS) {
    return errorResult(
      `Result too large (${text.length} chars, limit ${MAX_OUTPUT_CHARS}). Lower the limit or narrow the filters.`,
      "output_too_large"
    );
  }
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text },
    ],
    structuredContent: JSON.parse(text) as Record<string, unknown>,
  };
}

function logCall(ctx: McpContext, tool: string, ok: boolean, ms: number, code?: string) {
  // Ids and timing only: never arguments, mail, codes or profile data.
  const user = createHash("sha256").update(ctx.userId).digest("hex").slice(0, 10);
  console.info(`[mcp] user=${user} tool=${tool} ok=${ok} ms=${ms}${code ? ` code=${code}` : ""}`);
}

export function createYoloApplyMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: [
      "YOLOapply tracks one candidate's job search. Use it to find jobs, read the candidate's truthful profile and saved answers, prepare resumes, track applications and read application emails.",
      "Employer forms are filled and submitted by the agent in a browser the candidate can watch; this server has no submit or send-email tool. Call get_browser_application_playbook before filling a form.",
      "Never record a submission without observed evidence. A click, a disconnect or an ambiguous page is an attempt: reconcile with search_application_emails before any retry.",
      "Never invent candidate facts. Unknown answers go to the candidate.",
    ].join(" "),
  });

  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; input: Shape; readOnly: boolean; openWorld?: boolean; timeoutMs?: number },
    handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<CallToolResult>
  ) => {
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: config.input,
        annotations: {
          title: config.title,
          readOnlyHint: config.readOnly,
          destructiveHint: false,
          idempotentHint: config.readOnly,
          openWorldHint: config.openWorld ?? false,
        },
      },
      (async (args: z.objectOutputType<Shape, z.ZodTypeAny>) => {
        const started = Date.now();
        try {
          const result = await withTimeout(handler(args), config.timeoutMs ?? DEFAULT_TIMEOUT_MS, name);
          logCall(ctx, name, !result.isError, Date.now() - started);
          return result;
        } catch (e) {
          const result = toToolError(e);
          logCall(ctx, name, false, Date.now() - started, (e as { code?: string })?.code ?? (e instanceof ToolTimeoutError ? "timeout" : "error"));
          return result;
        }
      }) as never
    );
  };

  const url = (path: string) => new URL(path, ctx.baseUrl).toString();

  // ── Account & candidate context ─────────────────────────────────────────

  tool(
    "get_account_status",
    {
      title: "Account status",
      description: "Setup readiness (profile, projects, LLM key, resume) and mailbox connection for the authenticated candidate.",
      input: {},
      readOnly: true,
    },
    async () => {
      const [setup, user, mail] = await Promise.all([
        getSetupStatus(ctx.userId),
        prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { email: true, createdAt: true } }),
        mailConnection(ctx.userId),
      ]);
      return jsonResult("Account status loaded.", { account: user, setup, mail, dashboardUrl: url("/") });
    }
  );

  tool(
    "get_application_context",
    {
      title: "Candidate application context",
      description:
        "Profile, project bank, the candidate's application-answer preferences text, scoped saved answers (consents, work authorization by country) and declaration defaults resolved for a hiring company. Read this before answering any employer question.",
      input: { company: shortText(200).optional().describe("Hiring company, to resolve prior-employment declarations.") },
      readOnly: true,
    },
    async ({ company }) => jsonResult("Application context loaded.", await getApplicationContext(ctx.userId, company))
  );

  tool(
    "get_browser_application_playbook",
    {
      title: "Browser application playbook",
      description:
        "Resume-parsing-first procedure for filling an employer form in the collaborative browser, with ATS-specific notes and evidence rules for recording outcomes.",
      input: {
        atsProvider: z.enum(["greenhouse", "lever", "ashby", "workday", "generic"]).optional(),
        url: z.string().url().max(2000).optional().describe("Application URL; used to detect the ATS."),
      },
      readOnly: true,
    },
    async ({ atsProvider, url: pageUrl }) =>
      jsonResult("Playbook loaded.", playbook(atsProvider ?? (pageUrl ? detectAtsProvider(pageUrl) : undefined)))
  );

  tool(
    "review_form_fields",
    {
      title: "Review parsed form fields",
      description:
        "After the employer site parsed the resume, compare observed field values with saved candidate facts. Returns per field: ok, ok_unverified, fill, correct, ask_candidate, review_sensitive, leave_optional or no_matching_option, with the exact saved value and, for dropdowns, the matching real option. Never invents values.",
      input: {
        company: shortText(200).optional(),
        fields: z
          .array(
            z.object({
              label: shortText(300),
              fieldType: z.string().max(40).optional(),
              required: z.boolean().optional(),
              displayedValue: z.string().max(2000).nullable().optional(),
              persistedValue: z.string().max(2000).nullable().optional(),
              options: z.array(z.string().max(300)).max(300).optional(),
            })
          )
          .min(1)
          .max(80),
      },
      readOnly: true,
    },
    async ({ company, fields }) => {
      const profile = await getProfileOrNull(ctx.userId);
      if (!profile) throw new ApiUserError("Set up the candidate profile first (Settings -> Profile).", 400, "no_profile");
      const reviews = reviewFields({
        fields,
        profile,
        declarationDefaults: readDeclarationDefaults(profile.applicationAnswers),
        company,
      });
      const counts = reviews.reduce<Record<string, number>>((acc, r) => ((acc[r.verdict] = (acc[r.verdict] ?? 0) + 1), acc), {});
      return jsonResult(`${reviews.length} fields reviewed.`, { counts, fields: reviews });
    }
  );

  // ── Discovery ───────────────────────────────────────────────────────────

  const searchFilters = {
    status: z.enum(["new", "dismissed", "promoted", "any"]).default("new").describe("Discover overlay state. new = not promoted or dismissed."),
    sources: z.array(shortText(40)).max(12).optional().describe(`Source ids: ${Object.keys(SOURCE_LABEL).join(", ")}.`),
    locations: z.array(shortText(80)).max(20).optional().describe("Any-of, case-insensitive substring of the listing location, e.g. Pune, Bengaluru, Remote."),
    includeUnknownLocation: z.boolean().default(false),
    roleKeywords: z.array(shortText(80)).max(20).optional().describe("Any-of substrings of the job title."),
    excludeRoleKeywords: z.array(shortText(80)).max(30).optional(),
    companies: z.array(shortText(120)).max(20).optional(),
    jobType: shortText(40).optional().describe('e.g. "Full Time", "Internship".'),
    maxYearsExperience: z.number().min(0).max(30).optional().describe("Keep jobs whose stated minimum experience is at most this. Unstated experience is kept unless requireKnownExperience."),
    requireKnownExperience: z.boolean().default(false),
    minScore: z.number().int().min(0).max(100).optional().describe("Minimum fit score. Unscored jobs are excluded when set."),
    postedWithinDays: z.number().int().min(1).max(365).optional().describe("Window on posted date, falling back to first-seen date for undated listings."),
    requireDescription: z.boolean().default(false).describe("Only jobs with a cached description of 200+ chars."),
    duplicatePolicy: z.enum(["exclude", "flag"]).default("exclude").describe("exclude = drop jobs matching a tracked application by URL, posting id or company+title; flag = keep and annotate."),
    sort: z.enum(["recent", "score"]).default("recent"),
  };

  tool(
    "search_jobs",
    {
      title: "Search jobs",
      description:
        "Page through the whole shared job catalog with stable cursors (no 500-row cap; undated listings ordered by first-seen date and marked dateBasis=discovered). Returns compact summaries with fit score, provenance and duplicate status. Salary is listing text only, never verified. Use get_job for the full description.",
      input: {
        ...searchFilters,
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().max(500).optional().describe("nextCursor from the previous page; filters must be identical."),
      },
      readOnly: true,
      timeoutMs: 45_000,
    },
    async (args) => {
      const result = await searchJobs(ctx.userId, args as JobSearchFilters & { limit: number; cursor?: string });
      return jsonResult(`${result.jobs.length} jobs (scanned ${result.scanned}, ${result.timingMs} ms).`, result);
    }
  );

  tool(
    "get_job_source_summary",
    {
      title: "Job counts by source",
      description: "Per-source totals (with undated and scored counts) under the same filters as search_jobs. Use it to see which sources have matches before paging.",
      input: searchFilters,
      readOnly: true,
    },
    async (args) => {
      const result = await sourceSummary(ctx.userId, args as JobSearchFilters);
      return jsonResult(`${result.sources.length} sources (${result.timingMs} ms).`, result);
    }
  );

  tool(
    "get_job",
    {
      title: "Job detail",
      description:
        "Full catalog record for one job: description, provenance (sources, first seen, last updated), salary disclosure, the candidate's fit score and duplicate matches. refreshLive=true re-fetches the live posting first (may use the candidate's LLM key; updates the shared catalog).",
      input: { jobId: id, refreshLive: z.boolean().default(false) },
      readOnly: false,
      openWorld: true,
      timeoutMs: 90_000,
    },
    async ({ jobId, refreshLive }) => {
      let lead = await prisma.jobLead.findUnique({ where: { id: jobId } });
      if (!lead) throw new ApiUserError("Job not found.", 404, "not_found");
      let live: { refreshed: boolean; at?: string; error?: string } = { refreshed: false };
      if (refreshLive) {
        try {
          lead = await refreshLeadJd(ctx.userId, lead);
          live = { refreshed: true, at: new Date().toISOString() };
        } catch (e) {
          const err = JSON.parse((toToolError(e).content[0] as { text: string }).text) as { error: string };
          live = { refreshed: false, error: err.error };
        }
      }
      const [overlay, index] = await Promise.all([
        prisma.userLead.findUnique({
          where: { userId_jobLeadId: { userId: ctx.userId, jobLeadId: lead.id } },
          select: { status: true, score: true, scoreReason: true, applicationId: true },
        }),
        loadApplicationIndex(ctx.userId),
      ]);
      const jd = lead.jdText ?? "";
      return jsonResult(`${lead.role} at ${lead.company}.`, {
        jobId: lead.id,
        company: lead.company,
        role: lead.role,
        location: lead.location,
        jobType: lead.jobType,
        experience: lead.experience,
        skills: lead.skills,
        salary: describeSalary(lead.salary),
        url: lead.url,
        companyUrl: lead.companyUrl,
        listedRecruiter: lead.recruiterName
          ? { name: lead.recruiterName, title: lead.recruiterTitle, company: lead.recruiterCompany }
          : null,
        provenance: {
          source: lead.source,
          sources: lead.sources,
          externalId: lead.externalId,
          postedAt: lead.postedAt,
          firstSeenAt: lead.createdAt,
          lastUpdatedAt: lead.updatedAt,
          dateBasis: lead.postedAt ? "posted" : "discovered",
          liveRefresh: live,
        },
        description: { quality: jdQuality(jd), length: jd.length, text: jd.slice(0, 40_000), truncated: jd.length > 40_000 },
        fit: overlay?.score != null ? { score: overlay.score, reason: overlay.scoreReason } : null,
        tracking: {
          overlayStatus: overlay?.status ?? "new",
          applicationId: overlay?.applicationId ?? null,
          duplicates: index.match({ urls: [lead.url, lead.canonicalUrl], company: lead.company, role: lead.role }),
        },
      });
    }
  );

  // ── Applications (tracker) ──────────────────────────────────────────────

  tool(
    "check_duplicate_application",
    {
      title: "Check for an existing application",
      description: "Match a URL and/or company+role against every tracked application (canonical URL, ATS posting id across boards, normalized company+title). Run before preparing or submitting.",
      input: { url: z.string().url().max(2000).optional(), company: shortText(200).optional(), role: shortText(200).optional() },
      readOnly: true,
    },
    async (args) => {
      if (!args.url && !(args.company && args.role)) {
        throw new ApiUserError("Provide a url, or both company and role.", 400, "invalid_input");
      }
      const result = await checkDuplicate(ctx.userId, args);
      return jsonResult(result.duplicate ? "Already tracked." : result.possibleDuplicate ? "Possible duplicate." : "No existing application.", result);
    }
  );

  tool(
    "list_applications",
    {
      title: "List applications",
      description: "Tracked applications, newest first, with status and submissionState (confirmed, unconfirmed_attempt, marked_applied_without_evidence, not_submitted). Cursor-paginated.",
      input: {
        statuses: z.array(z.enum(["draft", "personalized", "applied", "replied", "interview", "offer", "rejected", "closed"])).max(8).optional(),
        company: shortText(200).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().max(500).optional(),
      },
      readOnly: true,
    },
    async (args) => {
      const result = await listApplications(ctx.userId, args);
      return jsonResult(`${result.applications.length} applications.`, result);
    }
  );

  tool(
    "get_application",
    {
      title: "Application detail",
      description: "One tracked application with description, workflow tasks, files, recent events and submissionState.",
      input: { applicationId: id },
      readOnly: true,
    },
    async ({ applicationId }) => {
      const detail = await getApplicationDetail(ctx.userId, applicationId);
      return jsonResult(`${detail.role} at ${detail.company} (${detail.submissionState}).`, {
        ...detail,
        applicationUrl: url(`/applications/${detail.id}`),
      });
    }
  );

  tool(
    "create_application_draft",
    {
      title: "Create application draft",
      description:
        "Start tracking a job as a draft: from a catalog jobId, or from a posting URL (company/role/description optional; missing fields are extracted with the candidate's LLM key). Deduplicates against tracked applications. Does not contact the employer.",
      input: {
        jobId: id.optional(),
        url: z.string().url().max(2000).optional(),
        company: shortText(200).optional(),
        role: shortText(200).optional(),
        location: z.string().trim().max(300).optional(),
        jobDescription: z.string().trim().max(50_000).optional(),
        allowCompanyRoleMatch: z.boolean().default(false),
      },
      readOnly: false,
      openWorld: true,
      timeoutMs: 90_000,
    },
    async (args) => {
      if (!args.jobId && !args.url) throw new ApiUserError("Provide jobId or url.", 400, "invalid_input");
      const result = args.jobId
        ? await createDraft(ctx.userId, { jobId: args.jobId, allowCompanyRoleMatch: args.allowCompanyRoleMatch })
        : await createDraft(ctx.userId, { ...args, url: args.url!, allowCompanyRoleMatch: args.allowCompanyRoleMatch });
      return jsonResult(
        result.created ? "Draft created." : result.deduplicated ? "Already tracked; existing application returned." : "Not created: possible duplicate.",
        result
      );
    }
  );

  tool(
    "record_application_attempt",
    {
      title: "Record an application attempt",
      description:
        "Log progress on an employer form (form_opened, resume_uploaded, resume_parsed, fields_reviewed, submit_clicked) with outcome ok/blocked/failed/unknown. Never marks the application as applied. submit_clicked with outcome unknown flags the application for receipt reconciliation before any retry.",
      input: {
        applicationId: id,
        stage: z.enum(["form_opened", "resume_uploaded", "resume_parsed", "fields_reviewed", "submit_clicked"]),
        outcome: z.enum(["ok", "blocked", "failed", "unknown"]),
        pageUrl: z.string().url().max(2000).optional(),
        note: z.string().trim().max(1000).optional(),
        blockers: z.array(z.string().max(300)).max(20).optional(),
      },
      readOnly: false,
    },
    async ({ applicationId, ...input }) =>
      jsonResult("Attempt recorded.", await recordApplicationAttempt(ctx.userId, applicationId, input))
  );

  tool(
    "record_confirmed_submission",
    {
      title: "Record a confirmed submission",
      description:
        "Mark an application applied ONLY on evidence. site_confirmation: the confirmation text/title you observed. email_receipt: pass emailMessageId; the server reads the message, checks it is a receipt for this application and uses its received time. employer_duplicate_notice: the employer says an application already exists; give the ORIGINAL date via originalReceiptMessageId (preferred) or originalSubmittedAt + originalSubmittedAtSource. candidate_confirmed: the candidate told you. Idempotent; the earliest evidenced date wins.",
      input: {
        applicationId: id,
        evidenceKind: z.enum(["site_confirmation", "email_receipt", "employer_duplicate_notice", "candidate_confirmed"]),
        pageUrl: z.string().url().max(2000).optional(),
        pageTitle: z.string().trim().max(200).optional(),
        confirmationText: z.string().trim().max(500).optional(),
        confirmationNumber: z.string().trim().max(120).optional(),
        emailMessageId: z.string().trim().max(500).optional(),
        originalReceiptMessageId: z.string().trim().max(500).optional(),
        originalSubmittedAt: isoDate.optional(),
        originalSubmittedAtSource: z.string().trim().max(300).optional(),
        submittedAt: isoDate.optional().describe("When the site confirmed it, if not just now (e.g. recorded after a disconnect)."),
        submittedAtSource: z.string().trim().max(300).optional().describe("Required when submittedAt is more than 15 minutes ago: where that time comes from."),
        note: z.string().trim().max(500).optional(),
      },
      readOnly: false,
      timeoutMs: 45_000,
    },
    async (args) => {
      const base: ConfirmedSubmissionInput = {
        evidenceKind: args.evidenceKind,
        recordedBy: "agent",
        pageUrl: args.pageUrl,
        pageTitle: args.pageTitle,
        confirmationText: args.confirmationText,
        confirmationNumber: args.confirmationNumber,
        note: args.note,
        submittedAt: args.submittedAt ? new Date(args.submittedAt) : undefined,
        submittedAtSource: args.submittedAtSource,
      };
      if (args.evidenceKind === "email_receipt") {
        if (!args.emailMessageId) throw new ApiUserError("emailMessageId is required for an email receipt.", 400, "evidence_required");
        const mail = await getApplicationEmail(ctx.userId, { messageId: args.emailMessageId, applicationId: args.applicationId });
        if (!isReceiptFor(mail, args.applicationId)) {
          throw new ApiUserError(
            `That message is not unambiguously a receipt for this application (category ${mail.category}, match ${mail.matchConfidence}, top match ${mail.matches[0]?.applicationId ?? "none"}). Nothing was recorded; if several applications at this employer match, use site or candidate confirmation instead.`,
            409,
            "not_a_receipt"
          );
        }
        Object.assign(base, {
          emailMessageId: mail.internetMessageId ?? mail.messageId,
          emailFrom: mail.from,
          emailSubject: mail.subject,
          submittedAt: new Date(mail.receivedAt),
          confirmationText: base.confirmationText ?? mail.subject,
        });
      }
      if (args.evidenceKind === "employer_duplicate_notice") {
        if (args.originalReceiptMessageId) {
          const original = await getApplicationEmail(ctx.userId, {
            messageId: args.originalReceiptMessageId,
            applicationId: args.applicationId,
          });
          if (!isReceiptFor(original, args.applicationId, { requireRole: true })) {
            throw new ApiUserError(
              `originalReceiptMessageId is not unambiguously a receipt for this application (category ${original.category}, match ${original.matchConfidence}). Nothing was recorded.`,
              409,
              "not_a_receipt"
            );
          }
          Object.assign(base, {
            submittedAt: new Date(original.receivedAt),
            submittedAtSource: `original receipt email ${original.internetMessageId ?? original.messageId} from ${original.from}`,
            emailMessageId: original.internetMessageId ?? original.messageId,
            emailFrom: original.from,
            emailSubject: original.subject,
          });
        } else {
          // Unverified by mail: accepted to mark the application, but it can
          // never pull an existing appliedAt earlier.
          Object.assign(base, {
            submittedAt: args.originalSubmittedAt ? new Date(args.originalSubmittedAt) : undefined,
            submittedAtSource: args.originalSubmittedAtSource,
            dateVerified: false,
          });
        }
      }
      const result = await recordConfirmedSubmission(ctx.userId, args.applicationId, base);
      return jsonResult(
        result.alreadyRecorded ? "Already confirmed; evidence added." : `Submission recorded (applied ${result.appliedAt.toISOString()}).`,
        result
      );
    }
  );

  // ── Resumes ─────────────────────────────────────────────────────────────

  tool(
    "prepare_resume",
    {
      title: "Prepare tailored resume",
      description:
        "Start generating the one-page tailored resume for an application in the background (uses the candidate's LLM key and only saved facts). Returns immediately; a duplicate call while running returns already_running. Poll get_resume_status.",
      input: { applicationId: id },
      readOnly: false,
      openWorld: true,
    },
    async ({ applicationId }) => {
      const result = await startResumeGeneration(ctx.userId, applicationId);
      return jsonResult(result.started ? "Resume generation started." : "Resume generation already running.", {
        ...result,
        applicationId,
        poll: "get_resume_status",
      });
    }
  );

  tool(
    "get_resume_status",
    {
      title: "Resume status",
      description: "idle | running | completed | failed, with the generation task, attempt count and stored file metadata.",
      input: { applicationId: id },
      readOnly: true,
    },
    async ({ applicationId }) => {
      const status = await getResumeStatus(ctx.userId, applicationId);
      return jsonResult(`Resume ${status.status}.`, {
        ...status,
        download: status.files.some((f) => f.kind === "resume_pdf")
          ? {
              tool: "get_resume_file",
              httpUrl: url(`/api/applications/${applicationId}/resume?download=1`),
              httpAuth: "Same Authorization: Bearer header as this MCP connection.",
            }
          : null,
      });
    }
  );

  tool(
    "get_resume_file",
    {
      title: "Download resume bytes",
      description:
        "Base64 chunk of a resume file: the tailored PDF/TeX for an application, or the generic uploaded resume when applicationId is omitted. Read in chunks with offset until nextOffset is null; verify the sha256 of the assembled bytes.",
      input: {
        applicationId: id.optional(),
        format: z.enum(["pdf", "tex"]).default("pdf"),
        offset: z.number().int().min(0).default(0),
        maxBytes: z.number().int().min(1024).max(MAX_FILE_CHUNK).default(MAX_FILE_CHUNK),
      },
      readOnly: true,
    },
    async ({ applicationId, format, offset, maxBytes }) => {
      let data: Buffer | null = null;
      let filename = "";
      let updatedAt: Date | null = null;
      if (applicationId) {
        const owned = await prisma.application.findFirst({ where: { id: applicationId, userId: ctx.userId }, select: { id: true } });
        if (!owned) throw new ApiUserError("Application not found.", 404, "not_found");
        const file = await getFile(ctx.userId, applicationId, format === "tex" ? "resume_tex" : "resume_pdf");
        if (!file) throw new ApiUserError("No resume generated yet. Call prepare_resume and wait for completed.", 404, "no_resume");
        data = file.data;
        filename = file.meta.filename;
        updatedAt = file.meta.updatedAt;
      } else {
        if (format === "tex") throw new ApiUserError("The generic resume is a PDF only.", 400, "invalid_input");
        const file = await getFile(ctx.userId, null, "generic_resume");
        if (!file) throw new ApiUserError("No generic resume uploaded (Resume page).", 404, "no_resume");
        data = file.data;
        filename = file.meta.filename;
        updatedAt = file.meta.updatedAt;
      }
      if (offset > data.length) throw new ApiUserError("offset is past the end of the file.", 400, "invalid_offset");
      const chunk = data.subarray(offset, offset + maxBytes);
      const next = offset + chunk.length < data.length ? offset + chunk.length : null;
      return jsonResult(`${chunk.length} of ${data.length} bytes from offset ${offset}.`, {
        filename,
        mimeType: format === "tex" ? "text/x-tex" : "application/pdf",
        totalBytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        updatedAt,
        offset,
        bytes: chunk.length,
        nextOffset: next,
        base64: chunk.toString("base64"),
      });
    }
  );

  // ── Application mail (read-only Outlook) ────────────────────────────────

  tool(
    "get_mail_connection",
    {
      title: "Mailbox connection",
      description: "Whether the candidate's Outlook mailbox is connected with Mail.Read, and how to connect it if not. Gmail is not supported.",
      input: {},
      readOnly: true,
    },
    async () => jsonResult("Mail connection loaded.", await mailConnection(ctx.userId))
  );

  tool(
    "search_application_emails",
    {
      title: "Search application emails",
      description:
        "Find application mail (receipts, duplicate notices, rejections, assessments, interview requests, verification emails) in the connected Outlook mailbox, matched to tracked applications with confidence (single/ambiguous/none). Read-only; never marks messages read. Times are the mailbox's original received times.",
      input: {
        applicationId: id.optional(),
        company: shortText(120).optional(),
        since: isoDate.optional().describe("Default: 14 days before `until`."),
        until: isoDate.optional(),
        categories: z
          .array(
            z.enum([
              "application_receipt",
              "duplicate_notice",
              "rejection",
              "assessment",
              "interview_or_next_steps",
              "verification_code",
              "other",
            ])
          )
          .max(7)
          .optional(),
        includeUnmatched: z.boolean().default(false).describe("Include application-like mail that names no tracked employer."),
        limit: z.number().int().min(1).max(50).default(20),
      },
      readOnly: true,
      openWorld: true,
      timeoutMs: 60_000,
    },
    async (args) => {
      const result = await searchApplicationEmails(ctx.userId, {
        applicationId: args.applicationId,
        company: args.company,
        since: args.since ? new Date(args.since) : undefined,
        until: args.until ? new Date(args.until) : undefined,
        categories: args.categories,
        includeUnmatched: args.includeUnmatched,
        limit: args.limit,
      });
      return jsonResult(`${result.messages.length} application emails (scanned ${result.scannedMessages}, ${result.timingMs} ms).`, result);
    }
  );

  tool(
    "get_application_email",
    {
      title: "Read an application email",
      description:
        "Plain-text body of one application-related message (must name a tracked employer or classify as application mail). Account-security and financial mail is refused; verification codes are redacted here (use get_application_otp).",
      input: { messageId: z.string().trim().min(10).max(400), applicationId: id.optional() },
      readOnly: true,
      openWorld: true,
    },
    async (args) => jsonResult("Message loaded.", await getApplicationEmail(ctx.userId, args))
  );

  tool(
    "get_application_otp",
    {
      title: "Get verification code for an active application",
      description:
        "Return the verification code an employer/ATS just emailed for ONE application that is still being submitted. requestedAt = when you triggered the code. Only codes received after that (max 30 min), addressed to the candidate, from the employer or its ATS, naming the employer, with exactly one code. Refuses account-recovery/bank codes, ambiguous codes and codes already used for another application.",
      input: {
        applicationId: id,
        requestedAt: isoDate,
        maxAgeMinutes: z.number().int().min(1).max(30).default(15),
      },
      readOnly: false,
      openWorld: true,
      timeoutMs: 45_000,
    },
    async (args) => {
      const result = await getApplicationOtp(ctx.userId, {
        applicationId: args.applicationId,
        requestedAt: new Date(args.requestedAt),
        maxAgeMinutes: args.maxAgeMinutes,
      });
      return jsonResult(result.kind === "code" ? "Verification code found." : `No code released (${result.kind}).`, result);
    }
  );

  return server;
}

/** Tool names, for docs/tests. */
export const TOOL_NAMES = [
  "get_account_status",
  "get_application_context",
  "get_browser_application_playbook",
  "review_form_fields",
  "search_jobs",
  "get_job_source_summary",
  "get_job",
  "check_duplicate_application",
  "list_applications",
  "get_application",
  "create_application_draft",
  "record_application_attempt",
  "record_confirmed_submission",
  "prepare_resume",
  "get_resume_status",
  "get_resume_file",
  "get_mail_connection",
  "search_application_emails",
  "get_application_email",
  "get_application_otp",
] as const;
