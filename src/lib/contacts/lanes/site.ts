import { fetchText } from "../http";
import { htmlToText } from "../../html";
import { extractEmails, emailDomain, isRoleInbox } from "../verify";
import type { LaneResult, RawCandidate } from "../types";

// Company-website lane: fetch the homepage plus the usual people/contact pages,
// pull every published email, and keep the ones on (or near) the company's own
// domain. Published addresses are real, so they're marked verified. Personal-
// looking addresses outrank role inboxes (careers@…) in confidence.

const PATHS = ["", "/about", "/about-us", "/team", "/our-team", "/people", "/contact", "/contact-us", "/careers", "/jobs"];

// Also harvest mailto: links straight from the HTML (htmlToText drops the href).
function mailtoEmails(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) out.push(m[1]);
  return out;
}

export async function fetchSiteContacts(domain: string): Promise<LaneResult> {
  try {
    const found = new Map<string, RawCandidate>();
    // Fetch homepage first to confirm the site resolves; bail early if not.
    const pages = await Promise.all(
      PATHS.map((p) => fetchText(`https://${domain}${p}`).then((html) => ({ p, html })))
    );
    if (pages.every((x) => !x.html)) {
      return { source: "site", candidates: [], error: "site unreachable" };
    }

    for (const { html } of pages) {
      if (!html) continue;
      const emails = new Set([...extractEmails(htmlToText(html)), ...mailtoEmails(html).flatMap(extractEmails)]);
      for (const email of emails) {
        // Keep only addresses on the company's own (sub)domain — a foreign
        // address on the page is usually a vendor/partner, not the company.
        const ed = emailDomain(email);
        if (ed !== domain && !ed.endsWith(`.${domain}`)) continue;
        if (found.has(email)) continue;
        const role = isRoleInbox(email);
        found.set(email, {
          email,
          source: "site",
          confidence: role ? 0.55 : 0.8, // published personal address is strong
          verified: true,
          verifyMethod: "published",
        });
      }
    }
    return { source: "site", candidates: [...found.values()] };
  } catch (e: unknown) {
    return { source: "site", candidates: [], error: e instanceof Error ? e.message : String(e) };
  }
}
