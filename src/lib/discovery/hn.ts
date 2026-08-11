import { chatJson, serverApiKey } from "../llm";
import { htmlToText } from "../html";
import type { FetchResult, RawLead } from "./types";

// Hacker News "Ask HN: Who is hiring?" — monthly thread, startup-heavy, and the
// posts frequently include a founder's contact email, which feeds the
// cold-email flow. Comments are free text, so unlike the structured sources
// each new post costs one LLM extraction. Extraction is global work (one parse
// serves every user's fan-out), so it runs on the server-level DEEPSEEK_API_KEY
// — the only remaining use of that env var. The per-run cap below bounds cost,
// and posts already ingested by every participant are skipped, so the backlog
// drains across scheduled runs.

const MAX_EXTRACTIONS_PER_RUN = 10;
const LLM_BATCH = 5;

// A post must look India-friendly or remote, and mention a relevant stack.
const GEO_RE = /\bindia\b|\bremote\b/i;
const TECH_RE = /backend|back-end|full.?stack|\bjava\b|\bnode\b|software engineer|software developer|\bsde\b|typescript|python|golang|\bgo\b|postgres/i;

const EXTRACT_SYSTEM = `You parse job posts from Hacker News "Who is hiring" threads. Each post is one company's pitch, usually formatted "Company | Location | REMOTE/ONSITE | Role(s)".

For each post return:
- company: the company name
- role: the single role most relevant to a junior backend/full-stack engineer (if several roles are listed, pick that one; otherwise the main role)
- location: city/country plus REMOTE/ONSITE/HYBRID markers, as stated
- applyUrl: a direct application/careers URL if one appears, else ""
- contactEmail: a contact email if one appears, normalized to plain form (e.g. "jobs at acme dot com" -> "jobs@acme.com"), else ""

Never invent values — empty string when absent. Output STRICT JSON:
{"posts": [{"id": "...", "company": "...", "role": "...", "location": "...", "applyUrl": "...", "contactEmail": "..."}]}`;

interface HnItem {
  id: number;
  created_at: string;
  text?: string | null;
  children?: HnItem[];
}

interface ExtractedPost {
  id: string;
  company: string;
  role: string;
  location: string;
  applyUrl: string;
  contactEmail: string;
}

async function latestThreadId(): Promise<number> {
  const res = await fetch(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6"
  );
  if (!res.ok) throw new Error(`Algolia search returned HTTP ${res.status}`);
  const json = (await res.json()) as { hits: { objectID: string; title: string }[] };
  const hit = json.hits.find((h) => /who is hiring/i.test(h.title));
  if (!hit) throw new Error("no 'Who is hiring' thread found");
  return Number(hit.objectID);
}

// `seenIds` = "source::externalId" keys already ingested by EVERY participant
// (posts some users lack are re-extracted so their fan-out gets them too).
export async function fetchHnLeads(seenIds: ReadonlySet<string> = new Set()): Promise<FetchResult> {
  try {
    if (!process.env.DEEPSEEK_API_KEY) {
      return { source: "hn", leads: [], error: "server DEEPSEEK_API_KEY not set — HN extraction skipped" };
    }
    const threadId = await latestThreadId();
    const res = await fetch(`https://hn.algolia.com/api/v1/items/${threadId}`);
    if (!res.ok) throw new Error(`Algolia items returned HTTP ${res.status}`);
    const thread = (await res.json()) as HnItem;

    const candidates = (thread.children ?? [])
      .filter((c) => c.text && GEO_RE.test(c.text) && TECH_RE.test(c.text))
      .filter((c) => !seenIds.has(`hn::${c.id}`))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, MAX_EXTRACTIONS_PER_RUN);

    const leads: RawLead[] = [];
    for (let i = 0; i < candidates.length; i += LLM_BATCH) {
      const batch = candidates.slice(i, i + LLM_BATCH);
      const user = batch
        .map((c) => `## POST id=${c.id}\n${htmlToText(c.text!).slice(0, 1800)}`)
        .join("\n\n");
      const out = await chatJson<{ posts: ExtractedPost[] }>({
        apiKey: serverApiKey(),
        system: EXTRACT_SYSTEM,
        user: `${user}\n\n# TASK\nParse every post above.`,
        temperature: 0.2,
        maxTokens: 4096,
      });
      for (const p of out.posts ?? []) {
        const item = batch.find((c) => String(c.id) === String(p.id));
        if (!item || !p.company || !p.role) continue;
        leads.push({
          source: "hn",
          externalId: String(item.id),
          company: p.company,
          role: p.role,
          location: p.location || undefined,
          url: p.applyUrl || `https://news.ycombinator.com/item?id=${item.id}`,
          jdText: htmlToText(item.text!),
          contactEmail: p.contactEmail || undefined,
          postedAt: new Date(item.created_at),
        });
      }
    }

    return { source: "hn", leads };
  } catch (e: unknown) {
    return { source: "hn", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
