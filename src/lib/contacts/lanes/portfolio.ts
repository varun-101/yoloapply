import { fetchText, fetchJson } from "../http";
import { htmlToText } from "../../html";
import { extractEmails, emailDomain, isPlausibleEmail } from "../verify";
import { chatJson, type LlmConfig } from "../../llm";
import type { LaneResult, RawCandidate } from "../types";

// Portfolio lane: for people we located by NAME but have no email for, Google
// (via Serper.dev) their personal site / GitHub and extract a public email. This
// is the free-and-legit bridge for the addresses LinkedIn hides — engineers
// routinely publish an email on their own site even when their LinkedIn doesn't.
// Bounded hard: only the top few unresolved people, top 2 results each, regex
// first and a single cheap LLM extraction only when regex comes up empty.

const ENDPOINT = "https://google.serper.dev/search";
const MAX_PEOPLE = 6;
const MAX_RESULTS_PER_PERSON = 2;

interface SerperResponse {
  organic?: { title: string; link: string; snippet?: string }[];
}

interface Person {
  name: string;
  title?: string;
  linkedinUrl?: string;
}

async function searchLinks(name: string, company: string, key: string): Promise<string[]> {
  const q = `"${name}" ${company} (portfolio OR github OR personal website OR contact email)`;
  const res = await fetchJson<SerperResponse>(ENDPOINT, {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: 5 }),
  });
  const links = (res?.organic ?? []).map((o) => o.link).filter(Boolean);
  // Skip the walled gardens — they won't expose an email and waste a fetch.
  return links
    .filter((l) => !/linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com/.test(l))
    .slice(0, MAX_RESULTS_PER_PERSON);
}

// Choose the best email for a person from a page: prefer a personal-domain
// address over the company inbox; require it to look real.
function pickEmail(text: string, companyDomain: string): string | null {
  const emails = extractEmails(text).filter(isPlausibleEmail);
  if (emails.length === 0) return null;
  const personal = emails.find((e) => emailDomain(e) !== companyDomain);
  return personal ?? emails[0];
}

async function llmExtractEmail(text: string, name: string, llm: LlmConfig): Promise<string | null> {
  try {
    const out = await chatJson<{ email: string }>({
      ...llm,
      system:
        'You extract a single contact email for a named person from web page text. Return STRICT JSON {"email":"..."} — use "" if no email for that person appears. Never invent one.',
      user: `Person: ${name}\n\nPage text:\n"""\n${text.slice(0, 3000)}\n"""`,
      temperature: 0.1,
      maxTokens: 200,
    });
    const e = (out.email ?? "").toLowerCase().trim();
    return e && isPlausibleEmail(e) ? e : null;
  } catch {
    return null;
  }
}

export async function fetchPortfolioContacts(
  people: Person[],
  company: string,
  companyDomain: string,
  searchKey: string,
  llm?: LlmConfig
): Promise<LaneResult> {
  try {
    const targets = people.filter((p) => p.name).slice(0, MAX_PEOPLE);
    const candidates: RawCandidate[] = [];
    for (const person of targets) {
      const links = await searchLinks(person.name, company, searchKey);
      let resolved: string | null = null;
      let viaLlm = false; // regex-scraped address vs. LLM-inferred from the page
      for (const link of links) {
        const html = await fetchText(link);
        if (!html) continue;
        const text = htmlToText(html);
        const direct = pickEmail(text, companyDomain);
        if (direct) {
          resolved = direct;
          break;
        }
        if (llm) {
          const inferred = await llmExtractEmail(text, person.name, llm);
          if (inferred) {
            resolved = inferred;
            viaLlm = true;
            break;
          }
        }
      }
      if (resolved) {
        candidates.push({
          name: person.name,
          title: person.title,
          linkedinUrl: person.linkedinUrl,
          email: resolved,
          source: "portfolio",
          // A regex-scraped address is literally on the page (trusted); an
          // LLM-inferred one is a softer signal, so score it lower and don't
          // claim it as verified/published.
          confidence: viaLlm ? 0.55 : 0.7,
          verified: !viaLlm,
          verifyMethod: viaLlm ? "llm" : "published",
        });
      }
    }
    return { source: "portfolio", candidates };
  } catch (e: unknown) {
    return { source: "portfolio", candidates: [], error: e instanceof Error ? e.message : String(e) };
  }
}
