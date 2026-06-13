import { resolveMx } from "dns/promises";

// Email helpers + lightweight verification. We deliberately do NOT do SMTP RCPT
// probing: sending VRFY/RCPT from the app's IP is widely blocked and can get the
// sending domain flagged (see CLAUDE.md deliverability note). The strongest free
// signal we use is "the domain has MX records" (it can receive mail at all),
// which is necessary-but-not-sufficient for a given mailbox. Addresses we found
// already published in public text (GitHub/site/HN) are trusted as real.

const EMAIL_RE = /\b[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+\b/gi;

// Junk that the email regex picks up off web pages: tracking pixels, asset
// filenames, example placeholders.
const JUNK_LOCAL = /^(?:no-?reply|noreply|donotreply|do-not-reply|mailer-daemon|postmaster|abuse|example|test|your|email|name|user|sentry|wordpress)$/i;
const JUNK_DOMAIN = /\.(?:png|jpg|jpeg|gif|svg|webp|css|js|json|woff2?|ttf)$/i;
const PLACEHOLDER = /(?:example\.(?:com|org)|email\.com|domain\.com|sentry\.io|wixpress\.com|godaddy\.com|@2x|@3x)/i;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
}

export function isPlausibleEmail(email: string): boolean {
  const e = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return false;
  const [local, domain] = e.split("@");
  if (JUNK_LOCAL.test(local)) return false;
  if (JUNK_DOMAIN.test(domain)) return false;
  if (PLACEHOLDER.test(e)) return false;
  // Asset hashes: a 32+ hex local part is almost never a person.
  if (/^[a-f0-9]{24,}$/i.test(local)) return false;
  return true;
}

// Pull every plausible email out of free text / HTML, deduped, lowercased.
export function extractEmails(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = normalizeEmail(m[0]);
    if (isPlausibleEmail(e)) out.add(e);
  }
  // Also catch obfuscated "name at company dot com" forms.
  for (const m of text.matchAll(/\b([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+)\s*([a-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*([a-z]{2,})\b/gi)) {
    const e = normalizeEmail(`${m[1]}@${m[2]}.${m[3]}`);
    if (isPlausibleEmail(e)) out.add(e);
  }
  return [...out];
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split("@")[1] ?? "";
}

// Role/generic inbox local-parts — used both to GENERATE role-inbox candidates
// and to recognise a scraped address as a non-personal inbox (lower confidence).
export const ROLE_LOCALS = [
  "careers",
  "jobs",
  "hiring",
  "recruiting",
  "recruitment",
  "hr",
  "people",
  "talent",
  "work",
  "join",
];
const GENERIC_LOCALS = [...ROLE_LOCALS, "hello", "contact", "info", "team", "support", "sales", "admin", "founders"];

export function isRoleInbox(email: string): boolean {
  const local = normalizeEmail(email).split("@")[0];
  return GENERIC_LOCALS.includes(local);
}

const mxCache = new Map<string, boolean>();

// Does this domain accept mail at all? Cached for the process lifetime.
export async function hasMx(domain: string): Promise<boolean> {
  const d = domain.toLowerCase();
  const cached = mxCache.get(d);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const records = await resolveMx(d);
    ok = records.length > 0 && records.some((r) => r.exchange);
  } catch {
    ok = false;
  }
  mxCache.set(d, ok);
  return ok;
}
