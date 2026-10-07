import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { ApiUserError } from "../../auth";
import { getMicrosoftAccessToken, microsoftConfigured } from "../../microsoft/oauth";
import { normalizeCompany } from "../jobIdentity";
import {
  classifyMessage,
  isAtsSender,
  matchApplications,
  matchConfidence,
  type ApplicationForMatching,
  type MailCategory,
  type MailMessage,
} from "./classify";
import { DEFAULT_OTP_MAX_AGE_MS, redactCodes, selectOtp, VERIFICATION_WORDING } from "./otp";

// Read-only access to the candidate's connected Outlook mailbox, narrowed to
// application mail. Uses the existing Microsoft OAuth connection (encrypted
// refresh token, cross-process refresh lease in microsoft/oauth.ts). Only GET
// requests are made: nothing is sent, moved, deleted or marked read (a Graph
// GET never changes isRead). Access tokens never leave this module.

const GRAPH = "https://graph.microsoft.com/v1.0";
const GRAPH_TIMEOUT_MS = 15_000;
const LIST_SELECT = "id,internetMessageId,subject,from,toRecipients,receivedDateTime,bodyPreview";
const MAX_BODY_CHARS = 20_000;
export const OTP_EVENT = "MAILBOX_OTP_READ";

interface GraphRecipient {
  emailAddress?: { address?: string | null; name?: string | null } | null;
}
interface GraphMessage {
  id: string;
  internetMessageId?: string | null;
  subject?: string | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  bodyPreview?: string | null;
  body?: { contentType?: string; content?: string } | null;
}

export function toMailMessage(g: GraphMessage, bodyText?: string): MailMessage {
  return {
    id: g.id,
    internetMessageId: g.internetMessageId ?? null,
    subject: g.subject ?? "",
    fromAddress: g.from?.emailAddress?.address ?? "",
    fromName: g.from?.emailAddress?.name ?? "",
    toAddresses: [...(g.toRecipients ?? []), ...(g.ccRecipients ?? [])]
      .map((r) => r.emailAddress?.address ?? "")
      .filter(Boolean),
    receivedAt: g.receivedDateTime ?? "",
    preview: bodyText ?? g.bodyPreview ?? "",
  };
}

export type GraphFetch = (path: string, headers?: Record<string, string>) => Promise<unknown>;

/** Real Graph GET with the user's token. Injected in tests. */
export function graphFetcher(userId: string): GraphFetch {
  return async (path, headers = {}) => {
    const token = await getMicrosoftAccessToken(userId);
    let res: Response;
    try {
      res = await fetch(`${GRAPH}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, ...headers },
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
    } catch (e) {
      throw new ApiUserError(
        `Outlook did not answer in time (${e instanceof Error ? e.name : "network error"}). Try again.`,
        504,
        "mail_timeout"
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ApiUserError(
        "Outlook rejected mailbox access. Reconnect Outlook in Settings -> Credentials (Mail.Read is required).",
        res.status,
        "mail_access_denied"
      );
    }
    if (res.status === 404) throw new ApiUserError("Message not found in the mailbox.", 404, "mail_not_found");
    if (res.status === 429) {
      throw new ApiUserError(
        `Outlook is throttling requests. Retry after ${res.headers.get("retry-after") ?? "a short wait"} seconds.`,
        429,
        "mail_throttled"
      );
    }
    if (!res.ok) throw new ApiUserError(`Outlook request failed (${res.status}).`, 502, "mail_error");
    return res.json();
  };
}

export async function mailConnection(userId: string) {
  const cred = await prisma.userCredential.findUnique({
    where: { userId },
    select: { msEmail: true, msScopes: true, msConnectedAt: true, msRefreshTokenEnc: true },
  });
  const connected = !!cred?.msRefreshTokenEnc;
  const scopes = (cred?.msScopes ?? "").split(/\s+/).filter(Boolean);
  const mailRead = scopes.some((s) => s.toLowerCase() === "mail.read");
  return {
    provider: "outlook" as const,
    serverConfigured: microsoftConfigured(),
    connected,
    mailbox: connected ? cred?.msEmail ?? null : null,
    connectedAt: connected ? cred?.msConnectedAt ?? null : null,
    mailReadGranted: connected && mailRead,
    gmailSupported: false,
    setup: connected && mailRead
      ? null
      : "Open YOLOapply Settings -> Credentials and click Connect Outlook (grants Mail.Read). Mail tools stay unavailable until then.",
  };
}

async function requireMailbox(userId: string) {
  const conn = await mailConnection(userId);
  if (!conn.connected || !conn.mailReadGranted) {
    throw new ApiUserError(conn.setup ?? "Outlook is not connected.", 400, "no_mailbox");
  }
  return conn;
}

async function ownedApplications(userId: string, applicationId?: string): Promise<ApplicationForMatching[]> {
  return prisma.application.findMany({
    where: { userId, ...(applicationId ? { id: applicationId } : {}) },
    select: { id: true, company: true, role: true, status: true, createdAt: true, appliedAt: true },
  });
}

/** KQL-safe term: letters, digits and a few joiners only. */
export function kqlTerm(raw: string): string | null {
  const term = raw.replace(/[^\p{L}\p{N} .&'-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return term.length >= 2 ? term : null;
}

async function listMessages(
  graph: GraphFetch,
  opts: { since: Date; until: Date; term: string | null; maxMessages: number }
): Promise<{ messages: GraphMessage[]; coverageComplete: boolean }> {
  const out: GraphMessage[] = [];
  let path: string;
  if (opts.term) {
    // $search cannot be combined with $filter/$orderby; the window is applied below.
    const q = new URLSearchParams({ $search: `"${opts.term}"`, $select: LIST_SELECT, $top: "50" });
    path = `/me/messages?${q.toString()}`;
  } else {
    const q = new URLSearchParams({
      $filter: `receivedDateTime ge ${opts.since.toISOString()} and receivedDateTime le ${opts.until.toISOString()}`,
      $orderby: "receivedDateTime desc",
      $select: LIST_SELECT,
      $top: "50",
    });
    path = `/me/messages?${q.toString()}`;
  }
  for (let page = 0; page < Math.ceil(opts.maxMessages / 50) && path; page++) {
    const data = (await graph(path)) as { value?: GraphMessage[]; "@odata.nextLink"?: string };
    out.push(...(data.value ?? []));
    const next = data["@odata.nextLink"];
    // Follow only Graph's own next links, relative to the v1.0 root.
    path = next && next.startsWith(GRAPH + "/") ? next.slice(GRAPH.length) : "";
  }
  // Complete only if Graph had nothing more to page: an unfinished listing
  // means "no receipt found" is NOT evidence that nothing was received.
  const coverageComplete = !path;
  return {
    coverageComplete,
    messages: out.filter((m) => {
      const at = Date.parse(m.receivedDateTime ?? "");
      return !Number.isNaN(at) && at >= opts.since.getTime() && at <= opts.until.getTime();
    }),
  };
}

function searchable(c: MailCategory): boolean {
  return c !== "account_security" && c !== "marketing" && c !== "job_alert";
}

const APPLICATION_CATEGORIES: MailCategory[] = [
  "application_receipt",
  "duplicate_notice",
  "rejection",
  "assessment",
  "interview_or_next_steps",
  "verification_code",
];

export interface SearchMailInput {
  applicationId?: string;
  company?: string;
  since?: Date;
  until?: Date;
  categories?: MailCategory[];
  includeUnmatched: boolean;
  limit: number;
}

export async function searchApplicationEmails(userId: string, input: SearchMailInput, graph = graphFetcher(userId)) {
  const conn = await requireMailbox(userId);
  const started = Date.now();
  const until = input.until ?? new Date();
  const since = input.since ?? new Date(until.getTime() - 14 * 86_400_000);
  if (until.getTime() - since.getTime() > 120 * 86_400_000) {
    throw new ApiUserError("Search windows are limited to 120 days.", 400, "window_too_large");
  }
  const apps = await ownedApplications(userId, input.applicationId);
  if (input.applicationId && !apps.length) throw new ApiUserError("Application not found.", 404, "not_found");
  const company = input.company ?? (input.applicationId ? apps[0].company : undefined);
  const term = company ? kqlTerm(company) : null;
  const listing = await listMessages(graph, { since, until, term, maxMessages: 300 });
  const raw = listing.messages;

  const categories = new Set((input.categories?.length ? input.categories : APPLICATION_CATEGORIES).filter(searchable));
  const results = [];
  for (const g of raw) {
    const m = toMailMessage(g);
    const category = classifyMessage(m);
    if (!categories.has(category)) continue;
    const matches = matchApplications(m, apps);
    // Unmatched mail is listed only when it is unmistakably application mail;
    // "other" mail must come from an ATS AND name a tracked employer.
    if (!matches.length && (!input.includeUnmatched || category === "other")) continue;
    if (category === "other" && !isAtsSender(m.fromAddress)) continue;
    const hideCodes = category === "verification_code" || VERIFICATION_WORDING.test(`${m.subject}\n${m.preview}`);
    results.push({
      messageId: m.id,
      internetMessageId: m.internetMessageId,
      receivedAt: m.receivedAt,
      from: m.fromAddress,
      fromName: m.fromName,
      subject: (hideCodes ? redactCodes(m.subject) : m.subject).slice(0, 300),
      preview: (hideCodes ? redactCodes(m.preview) : m.preview).slice(0, 300),
      category,
      addressedToCandidate: m.toAddresses.some((a) => a.toLowerCase() === conn.mailbox?.toLowerCase()),
      matchConfidence: matchConfidence(matches),
      matches: matches.slice(0, 3),
    });
    if (results.length >= input.limit) break;
  }
  return {
    mailbox: conn.mailbox,
    window: { since: since.toISOString(), until: until.toISOString() },
    query: term ? { mode: "search", term } : { mode: "date_window" },
    scannedMessages: raw.length,
    coverageComplete: listing.coverageComplete,
    messages: results,
    timingMs: Date.now() - started,
    note: listing.coverageComplete
      ? "Categories come from deterministic text rules; read the message before treating a receipt as proof. Never count a rejection or marketing mail as a submission."
      : "Listing was cut off before covering the whole window: an absent receipt is NOT evidence the application was not received. Narrow the window or company before deciding to retry.",
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchMessage(graph: GraphFetch, messageId: string) {
  if (!/^[A-Za-z0-9+/=_-]{10,400}$/.test(messageId)) {
    throw new ApiUserError("Invalid message id.", 400, "invalid_message_id");
  }
  const q = new URLSearchParams({ $select: `${LIST_SELECT},ccRecipients,body` });
  const g = (await graph(`/me/messages/${encodeURIComponent(messageId)}?${q.toString()}`, {
    Prefer: 'outlook.body-content-type="text"',
  })) as GraphMessage;
  const body = g.body?.content ?? "";
  const text = g.body?.contentType?.toLowerCase() === "html" ? htmlToText(body) : body;
  return { g, text };
}

export async function getApplicationEmail(
  userId: string,
  input: { messageId: string; applicationId?: string },
  graph = graphFetcher(userId)
) {
  const conn = await requireMailbox(userId);
  // Scored against ALL tracked applications, so a receipt for one role is not
  // credited to another role at the same company.
  const apps = await ownedApplications(userId);
  if (input.applicationId && !apps.some((a) => a.id === input.applicationId)) {
    throw new ApiUserError("Application not found.", 404, "not_found");
  }
  const { g, text } = await fetchMessage(graph, input.messageId);
  const m = toMailMessage(g, text);
  const category = classifyMessage(m);
  const matches = matchApplications(m, apps);
  // Only application mail is readable here: it must classify as application
  // mail or name one of the candidate's tracked employers.
  const readable =
    APPLICATION_CATEGORIES.includes(category) || (category === "other" && matches.length > 0 && isAtsSender(m.fromAddress));
  if (!readable) {
    throw new ApiUserError(
      `That message is not application mail (category ${category}), so it is not readable through this tool.`,
      403,
      "not_application_mail"
    );
  }
  if (category === "account_security") {
    throw new ApiUserError("Account-security and financial messages are never readable through this tool.", 403, "not_application_mail");
  }
  // Codes are only released through get_application_otp, which binds them to
  // one live application challenge.
  const hideCodes = category === "verification_code" || VERIFICATION_WORDING.test(`${m.subject}\n${text}`);
  const redacted = hideCodes ? redactCodes(text) : text;
  return {
    mailbox: conn.mailbox,
    messageId: m.id,
    internetMessageId: m.internetMessageId,
    receivedAt: m.receivedAt,
    from: m.fromAddress,
    fromName: m.fromName,
    to: m.toAddresses,
    subject: hideCodes ? redactCodes(m.subject) : m.subject,
    category,
    matchConfidence: matchConfidence(matches),
    matches: matches.slice(0, 3),
    bodyText: redacted.slice(0, MAX_BODY_CHARS),
    bodyTruncated: redacted.length > MAX_BODY_CHARS,
  };
}

export function messageFingerprint(messageId: string): string {
  return createHash("sha256").update(messageId).digest("hex").slice(0, 32);
}

const OTP_ACTIVE_STATUSES = new Set(["draft", "personalized"]);

export async function getApplicationOtp(
  userId: string,
  input: { applicationId: string; requestedAt: Date; maxAgeMinutes?: number },
  graph = graphFetcher(userId)
) {
  const conn = await requireMailbox(userId);
  const app = await prisma.application.findFirst({
    where: { id: input.applicationId, userId },
    select: { id: true, company: true, status: true, applyUrl: true, jdUrl: true },
  });
  if (!app) throw new ApiUserError("Application not found.", 404, "not_found");
  if (!OTP_ACTIVE_STATUSES.has(app.status)) {
    throw new ApiUserError(
      `Codes are only released for an application that is still being submitted (status is "${app.status}").`,
      409,
      "application_not_active"
    );
  }
  // Two applications at the same employer in flight at once: a code naming
  // only the employer can't be attributed, so don't guess.
  const others = await prisma.application.findMany({
    where: { userId, id: { not: app.id }, status: { in: [...OTP_ACTIVE_STATUSES] } },
    select: { id: true, company: true, events: { where: { type: { in: ["APPLICATION_ATTEMPT", "SUBMISSION_UNCONFIRMED"] }, createdAt: { gte: new Date(Date.now() - 30 * 60_000) } }, select: { id: true }, take: 1 } },
  });
  const concurrent = others.filter((o) => o.events.length && normalizeCompany(o.company) === normalizeCompany(app.company));
  if (concurrent.length) {
    return {
      applicationId: app.id,
      kind: "ambiguous" as const,
      reason: "Another application at this employer had form activity in the last 30 minutes, so the code can't be attributed. Finish one application at a time.",
      messageIds: [],
    };
  }
  const now = new Date();
  const maxAgeMs = Math.min(30, Math.max(1, input.maxAgeMinutes ?? DEFAULT_OTP_MAX_AGE_MS / 60_000)) * 60_000;
  if (Number.isNaN(input.requestedAt.getTime()) || input.requestedAt.getTime() > now.getTime() + 60_000) {
    throw new ApiUserError("requestedAt must be the time the code was requested (not in the future).", 400, "invalid_date");
  }
  if (now.getTime() - input.requestedAt.getTime() > maxAgeMs) {
    throw new ApiUserError("That code request is too old. Request a fresh code on the employer page first.", 409, "challenge_expired");
  }
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { email: true } });
  const recipients = [conn.mailbox, profile?.email].filter((v): v is string => !!v);
  const employerDomains = [app.applyUrl, app.jdUrl]
    .map((u) => {
      try {
        return u ? new URL(u).hostname : null;
      } catch {
        return null;
      }
    })
    .filter((v): v is string => !!v);

  const since = new Date(Math.max(input.requestedAt.getTime() - 60_000, now.getTime() - maxAgeMs));
  const { messages: raw } = await listMessages(graph, { since, until: new Date(now.getTime() + 60_000), term: null, maxMessages: 50 });
  // Previews are short; codes sometimes sit lower in the body. Read the full
  // text of at most five plausible candidates.
  const plausible = raw.filter((g) => /\b(code|otp|passcode|verif|one[- ]time)/i.test(`${g.subject ?? ""} ${g.bodyPreview ?? ""}`));
  const messages: MailMessage[] = [];
  for (const g of plausible.slice(0, 5)) {
    const { g: full, text } = await fetchMessage(graph, g.id);
    messages.push(toMailMessage(full, text));
  }
  const selection = selectOtp(messages, {
    company: app.company,
    applicationId: app.id,
    requestedAt: input.requestedAt,
    now,
    maxAgeMs,
    recipients,
    employerDomains,
  });
  if (selection.kind !== "code") return { applicationId: app.id, ...selection };

  // One code message serves one application. The fingerprint (not the code)
  // is stored so reuse for a different application is refused.
  const fingerprint = messageFingerprint(selection.messageId);
  // Check-and-record under a per-user, per-message advisory lock so two
  // concurrent calls for different applications can't both release it.
  const lockKey = `${userId}:${fingerprint}`;
  const verdict = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const prior = await tx.event.findFirst({
      where: {
        type: OTP_EVENT,
        application: { userId },
        metadata: { path: ["messageFingerprint"], equals: fingerprint },
      },
      select: { applicationId: true },
    });
    if (prior && prior.applicationId !== app.id) return "used_elsewhere" as const;
    if (!prior) {
      await tx.event.create({
        data: {
          applicationId: app.id,
          type: OTP_EVENT,
          detail: "Verification code read from the candidate's mailbox.",
          metadata: {
            messageFingerprint: fingerprint,
            receivedAt: selection.receivedAt,
            from: selection.from,
            requestedAt: input.requestedAt.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }
    return "ok" as const;
  });
  if (verdict === "used_elsewhere") {
    return {
      applicationId: app.id,
      kind: "none" as const,
      reason: "The newest code was already released for a different application. Request a fresh code.",
      rejected: [],
    };
  }
  return { applicationId: app.id, ...selection };
}
