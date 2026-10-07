import { normalizeCompany, normalizeRole } from "../jobIdentity";
import { looksCodeBearing } from "./otp";

// Pure classification of mailbox messages for application tracking. Nothing
// here calls Graph or the database, so the receipt/rejection/marketing and
// application-matching rules are unit-tested on synthetic messages.

export interface MailMessage {
  id: string;
  internetMessageId?: string | null;
  subject: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  receivedAt: string; // ISO, as Graph reported it
  preview: string; // bodyPreview, or the plain body when available
}

export type MailCategory =
  | "application_receipt"
  | "duplicate_notice"
  | "rejection"
  | "assessment"
  | "interview_or_next_steps"
  | "verification_code"
  | "account_security"
  | "job_alert"
  | "marketing"
  | "other";

// Senders that host candidate-facing mail for many employers.
export const ATS_SENDER_DOMAINS = [
  "greenhouse.io",
  "greenhouse-mail.io",
  "lever.co",
  "ashbyhq.com",
  "myworkday.com",
  "workday.com",
  "smartrecruiters.com",
  "icims.com",
  "rippling.com",
  "workable.com",
  "workablemail.com",
  "jobvite.com",
  "bamboohr.com",
  "recruitee.com",
  "teamtailor.com",
  "personio.com",
  "personio.de",
  "keka.com",
  "darwinbox.in",
  "darwinbox.com",
  "zohorecruit.com",
  "freshteam.com",
  "breezy.hr",
  "applytojob.com",
  "successfactors.com",
  "taleo.net",
  "eightfold.ai",
  "gem.com",
  "wellfound.com",
  "instahyre.com",
];

export function senderDomain(address: string): string {
  return address.toLowerCase().split("@")[1]?.trim() ?? "";
}

export function isAtsSender(address: string): boolean {
  const domain = senderDomain(address);
  return ATS_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

// Account recovery and sign-in alerts are never application mail, whoever
// sends them (an ATS candidate portal can send a password reset too).
export const ACCOUNT_RECOVERY =
  /\b(password reset|reset\b[^.\n]{0,40}\bpassword|forgot (your )?password|account recovery|recover (your )?account|unusual sign[- ]?in|new sign[- ]?in|sign[- ]?in (attempt|alert)|security alert|unlock (your )?account)\b/i;
const FINANCIAL =
  /\b(bank|transaction|debit|credit card|upi|netbanking|net banking|payment|aadhaar|pan card|microsoft account|google account|apple id|wallet|two[- ]factor|2fa)\b/i;
const DUPLICATE = /\b(already (applied|submitted|received)|duplicate application|previously applied|existing application)\b/i;
// Definite rejection wording. "Unfortunately" alone is weak: receipts often
// say "unfortunately we can't reply to everyone".
const REJECTION =
  /\b(not (be )?(moving|move|proceeding|progressing) forward|(will|would) not be (moving|progressing|proceeding)|won'?t be (moving|progressing|proceeding)|not (be )?proceeding|different direction|decided not to|(move|moving) forward with (other|another)|go(ing)? with (another|other) candidate|pursue other|other candidates|position has been filled|no longer (being )?considered|regret to inform|not (been )?selected)\b/i;
const WEAK_REJECTION = /\bunfortunately\b/i;
const RECEIPT =
  /\b(thank(s| you) for (applying|your application|submitting your application)|application (has been |was )?(received|submitted)|received your application|application confirmation|successfully (applied|submitted)|confirm(ing)? (receipt|that we received)|thank(s| you) for your interest in [^.\n]{0,80}\b(role|position|opening|job)\b)\b/i;
const ASSESSMENT = /\b(assessment|coding (challenge|test|exercise)|take[- ]home|hackerrank|codility|codesignal|testgorilla|online test)\b/i;
const INTERVIEW = /\b(interview|schedule (a|your) (call|chat|conversation)|book a time|next round|availability for)\b/i;
const JOB_ALERT = /\b(job alerts?|jobs? (for you|matching|you may like)|recommended jobs|new jobs|jobs near you|apply now to|similar jobs)\b/i;
const MARKETING_STRONG = /\b(newsletter|webinar|% off|limited time|offer ends|promo code|discount|register now)\b/i;
const MARKETING = /\b(unsubscribe|newsletter|webinar|% off|limited time|offer ends|promo|discount)\b/i;

export function classifyMessage(m: Pick<MailMessage, "subject" | "preview" | "fromAddress">): MailCategory {
  const text = `${m.subject}\n${m.preview}`;
  // The opening carries the message's purpose; footers carry alerts and ads.
  const head = `${m.subject}\n${m.preview.slice(0, 400)}`;
  const ats = isAtsSender(m.fromAddress);
  if (ACCOUNT_RECOVERY.test(text)) return "account_security";
  // Fails closed: a non-ATS bank employer's mail is hidden too.
  if (FINANCIAL.test(text) && !ats) return "account_security";
  if (looksCodeBearing(text)) return "verification_code";
  if (DUPLICATE.test(text)) return "duplicate_notice";
  if (REJECTION.test(text)) return "rejection";
  const receipt = RECEIPT.test(head) || (RECEIPT.test(text) && !JOB_ALERT.test(text) && !MARKETING_STRONG.test(text));
  if (WEAK_REJECTION.test(text) && !receipt) return "rejection";
  if (receipt) return "application_receipt";
  if (ASSESSMENT.test(text)) return "assessment";
  if (INTERVIEW.test(text)) return "interview_or_next_steps";
  if (JOB_ALERT.test(text)) return "job_alert";
  if (MARKETING.test(text)) return "marketing";
  return "other";
}

export interface ApplicationForMatching {
  id: string;
  company: string;
  role: string;
  status: string;
  createdAt: Date;
  appliedAt: Date | null;
}

export interface MessageMatch {
  applicationId: string;
  company: string;
  role: string;
  score: number;
  signals: string[];
}

function wordsIn(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const hay = ` ${normalizeCompany(text)} `;
  return hay.includes(` ${phrase} `);
}

const ROLE_STOPWORDS = new Set(["and", "the", "for", "of", "in", "to", "a", "an", "i", "ii", "iii", "with", "at"]);

/**
 * Scores how well a message refers to each application. Company must appear
 * (subject, sender name or body) for any match; role words only rank between
 * applications at the same company.
 */
export function matchApplications(m: MailMessage, apps: ApplicationForMatching[]): MessageMatch[] {
  const matches: MessageMatch[] = [];
  const subject = m.subject;
  const body = m.preview;
  const fromName = m.fromName;
  const fromDomain = senderDomain(m.fromAddress);
  for (const app of apps) {
    const company = normalizeCompany(app.company);
    if (!company || company.length < 2) continue;
    const signals: string[] = [];
    let score = 0;
    if (wordsIn(subject, company)) {
      score += 3;
      signals.push("company_in_subject");
    }
    if (wordsIn(fromName, company)) {
      score += 3;
      signals.push("company_in_sender_name");
    }
    const compactCompany = company.replace(/\s+/g, "");
    if (compactCompany.length >= 4 && fromDomain.replace(/[^a-z0-9.]/g, "").split(".").includes(compactCompany)) {
      score += 3;
      signals.push("company_sender_domain");
    }
    if (wordsIn(body, company)) {
      score += 2;
      signals.push("company_in_body");
    }
    if (!score) continue;
    const roleWords = normalizeRole(app.role).split(" ").filter((w) => w.length > 2 && !ROLE_STOPWORDS.has(w));
    const text = normalizeRole(`${subject} ${body}`);
    const hits = roleWords.filter((w) => ` ${text} `.includes(` ${w} `)).length;
    if (roleWords.length && hits) {
      const roleScore = hits === roleWords.length ? 2 : 1;
      score += roleScore;
      signals.push(roleScore === 2 ? "role_in_text" : "partial_role_in_text");
    }
    // Mail older than the application row can still be its receipt when the
    // row was recorded late, so this only ranks, never excludes.
    if (new Date(m.receivedAt).getTime() >= app.createdAt.getTime() - 86_400_000) {
      score += 1;
      signals.push("after_tracking_started");
    }
    if (isAtsSender(m.fromAddress)) signals.push("ats_sender");
    matches.push({ applicationId: app.id, company: app.company, role: app.role, score, signals });
  }
  return matches.sort((a, b) => b.score - a.score);
}

export type MatchConfidence = "single" | "ambiguous" | "none";

export function matchConfidence(matches: MessageMatch[]): MatchConfidence {
  if (!matches.length) return "none";
  if (matches.length > 1 && matches[0].score === matches[1].score) return "ambiguous";
  return "single";
}
