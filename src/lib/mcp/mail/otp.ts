import { classifyMessage, isAtsSender, matchApplications, senderDomain, type MailMessage } from "./classify";
import { normalizeCompany } from "../jobIdentity";

// Selecting a one-time code for ONE active application challenge. Every rule
// here exists to avoid handing an agent the wrong secret: a bank or account
// recovery code, a code for a different employer, a stale code, or one picked
// from a set of conflicting codes.

export const DEFAULT_OTP_MAX_AGE_MS = 15 * 60 * 1000;
// Typical ATS codes are valid 10-15 minutes; report the conservative end.
export const OTP_ASSUMED_VALIDITY_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

// A code token: two digit groups ("482 913"), spaced single digits
// ("4 8 2 9 1 3"), or 4-12 letters/digits. Letters-only tokens are accepted
// only in labelled positions and only if they don't look like a word.
const TOKEN = String.raw`(\d(?:[ -]\d){3,7}|\d{3,4}[ -]\d{3,4}|[A-Za-z0-9]{4,12})`;
const CODE_PATTERNS = [
  new RegExp(String.raw`\b(?:verification|security|confirmation|one[- ]time|access|login|sign[- ]?in|passcode|otp|pin)\s*(?:code|pin|password|passcode)?\s*(?:is|:|-)?\s*[:\-]?\s*` + TOKEN + String.raw`\b`, "gi"),
  new RegExp(String.raw`\b(?:code|pin|passcode)\s+is\s*:?\s*` + TOKEN + String.raw`\b`, "gi"),
  new RegExp(String.raw`\b(?:code|pin|passcode|otp)\b[^\n]{0,80}?[:\-]\s*` + TOKEN + String.raw`\b`, "gi"),
  new RegExp(String.raw`\b(?:use|enter|type)\s+(?:the\s+)?(?:code\s+)?` + TOKEN + String.raw`\b`, "gi"),
  // "code for your application to Acme: 123456" (digits only, close by).
  /\b(?:code|otp|passcode|pin)\b[^0-9\n]{0,60}?\b(\d(?:[ -]\d){3,7}|\d{3,4}[ -]\d{3,4}|\d{4,8})\b/gi,
];

// Words that look like codes after "code is" but are not.
const NOT_CODES = new Set([
  "below", "above", "valid", "expire", "expires", "please", "here", "this", "that", "your", "code", "field",
  "continue", "confirm", "verify", "application", "minutes", "following", "within", "only", "once", "again",
]);

/** Mentions a code at all. Read tools withhold the text of any such message (fail closed). */
export const CODE_WORDING = /\b(codes?|pin|otp|passcodes?|one[- ]time|verif(y|ication|ied))\b/i;
/** Back-compat name used by search/read callers. */
export const VERIFICATION_WORDING = CODE_WORDING;

function plausibleCode(token: string): boolean {
  if (NOT_CODES.has(token.toLowerCase())) return false;
  if (/\d/.test(token)) return true;
  // Letters only: accept generated-looking tokens (mixed case inside, or all
  // caps), never ordinary words.
  return token.length >= 6 && (/[a-z].*[A-Z]|[A-Z].*[a-z].*[A-Z]/.test(token.slice(1)) || /^[A-Z]{6,12}$/.test(token));
}

export function extractCodes(text: string): string[] {
  const codes = new Set<string>();
  for (const pattern of CODE_PATTERNS) {
    for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (plausibleCode(m[1])) codes.add(m[1]);
    }
  }
  // A code on its own line right after a sentence that mentions a code.
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 1; i < lines.length; i++) {
    if (
      /^(\d(?:[ -]\d){3,7}|\d{3,4}[ -]\d{3,4}|[A-Za-z0-9]{4,12})$/.test(lines[i]) &&
      plausibleCode(lines[i]) &&
      /\b(code|otp|passcode|pin|verify|verification)\b/i.test(lines.slice(Math.max(0, i - 3), i).join(" "))
    ) {
      codes.add(lines[i]);
    }
  }
  return [...codes];
}

/** Code-bearing mail: code wording plus an extractable code. */
export function looksCodeBearing(text: string): boolean {
  return CODE_WORDING.test(text) && extractCodes(text).length > 0;
}

/**
 * Replaces anything in code-bearing text that could be a one-time code:
 * labelled codes, digit runs (also grouped), and 4-12 character tokens that
 * mix letters and digits, case-insensitively.
 */
export function redactCodes(text: string): string {
  let out = text;
  for (const code of extractCodes(text)) out = out.split(code).join("[code redacted]");
  return out
    .replace(/\b\d(?:[ -]\d){3,7}\b/g, "[code redacted]")
    .replace(/\b\d{3,4}[ -]\d{3,4}\b/g, "[code redacted]")
    .replace(/\b\d{4,12}\b/g, "[code redacted]")
    .replace(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,12}\b/g, "[code redacted]");
}

export interface OtpPolicy {
  company: string;
  applicationId: string;
  /** When the agent triggered the code (pressed "send code" / submit). */
  requestedAt: Date;
  now: Date;
  maxAgeMs: number;
  /** Candidate mailbox addresses the code must be addressed to. */
  recipients: string[];
  /** Hosts from the application URLs, e.g. "acme.com", "jobs.lever.co". */
  employerDomains: string[];
}

export type OtpSelection =
  | {
      kind: "code";
      code: string;
      messageId: string;
      receivedAt: string;
      from: string;
      subject: string;
      useBefore: string;
      otherQualifyingMessages: number;
    }
  | { kind: "ambiguous"; reason: string; messageIds: string[] }
  | { kind: "none"; reason: string; rejected: { messageId: string; reason: string }[] };

function addressedTo(m: MailMessage, recipients: string[]): boolean {
  const wanted = new Set(recipients.map((r) => r.trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return false;
  return m.toAddresses.some((a) => wanted.has(a.trim().toLowerCase()));
}

function fromEmployerOrAts(m: MailMessage, employerDomains: string[]): boolean {
  const domain = senderDomain(m.fromAddress);
  if (isAtsSender(m.fromAddress)) return true;
  return employerDomains.some((d) => {
    const base = d.toLowerCase().replace(/^www\./, "");
    return domain === base || domain.endsWith("." + base) || base.endsWith("." + domain);
  });
}

export function selectOtp(messages: MailMessage[], policy: OtpPolicy): OtpSelection {
  const rejected: { messageId: string; reason: string }[] = [];
  const earliest = Math.max(policy.requestedAt.getTime() - CLOCK_SKEW_MS, policy.now.getTime() - policy.maxAgeMs);
  const company = normalizeCompany(policy.company);
  const qualifying: { m: MailMessage; code: string }[] = [];

  for (const m of messages) {
    const at = new Date(m.receivedAt).getTime();
    if (Number.isNaN(at) || at < earliest || at > policy.now.getTime() + CLOCK_SKEW_MS) {
      rejected.push({ messageId: m.id, reason: "outside_time_window" });
      continue;
    }
    const category = classifyMessage(m);
    if (category === "account_security") {
      rejected.push({ messageId: m.id, reason: "account_or_financial_security_message" });
      continue;
    }
    if (category !== "verification_code") {
      rejected.push({ messageId: m.id, reason: `not_a_verification_message:${category}` });
      continue;
    }
    if (!addressedTo(m, policy.recipients)) {
      rejected.push({ messageId: m.id, reason: "not_addressed_to_candidate_mailbox" });
      continue;
    }
    if (!fromEmployerOrAts(m, policy.employerDomains)) {
      rejected.push({ messageId: m.id, reason: "sender_not_employer_or_ats" });
      continue;
    }
    // The company must be named (or be the sender), so a code another
    // employer's ATS sent at the same time is never used here.
    const mentions = matchApplications(m, [
      { id: policy.applicationId, company: policy.company, role: "", status: "", createdAt: new Date(0), appliedAt: null },
    ]);
    if (!company || !mentions.length) {
      rejected.push({ messageId: m.id, reason: "company_not_referenced" });
      continue;
    }
    const codes = extractCodes(`${m.subject}\n${m.preview}`);
    if (codes.length !== 1) {
      rejected.push({ messageId: m.id, reason: codes.length ? "multiple_codes_in_message" : "no_code_found" });
      continue;
    }
    qualifying.push({ m, code: codes[0] });
  }

  if (!qualifying.length) {
    return {
      kind: "none",
      reason: "No recent verification code addressed to the candidate and referencing this employer.",
      rejected: rejected.slice(0, 20),
    };
  }
  qualifying.sort((a, b) => new Date(b.m.receivedAt).getTime() - new Date(a.m.receivedAt).getTime());
  const newest = qualifying[0];
  // Two different codes within seconds usually means two separate requests
  // (another tab, another employer flow). Don't guess.
  const conflicting = qualifying.filter(
    (q) => q.code !== newest.code && new Date(newest.m.receivedAt).getTime() - new Date(q.m.receivedAt).getTime() < 30_000
  );
  if (conflicting.length) {
    return {
      kind: "ambiguous",
      reason: "Several different codes arrived within 30 seconds. Request a fresh code once and try again.",
      messageIds: [newest.m.id, ...conflicting.map((q) => q.m.id)],
    };
  }
  return {
    kind: "code",
    code: newest.code,
    messageId: newest.m.id,
    receivedAt: newest.m.receivedAt,
    from: newest.m.fromAddress,
    subject: newest.m.subject,
    useBefore: new Date(new Date(newest.m.receivedAt).getTime() + OTP_ASSUMED_VALIDITY_MS).toISOString(),
    otherQualifyingMessages: qualifying.length - 1,
  };
}
