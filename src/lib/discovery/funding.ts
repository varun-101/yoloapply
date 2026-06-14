import { prisma } from "../db";
import { chatJson, serverApiKey } from "../llm";
import { htmlToText } from "../extractJob";

// Funding radar: freshly-funded startups hire aggressively, so a new round is an
// early signal that a company is about to open junior roles. There's no free
// structured funding API (Crunchbase/Tracxn/etc. are paid), so — exactly like the
// HN source — we read funding-news RSS and LLM-extract the structured event from
// each headline/summary on the server-level DEEPSEEK_API_KEY (global work, no user
// context). Two outputs:
//   1. a radar list (company + round + sector + link), cached in-memory for the
//      Discover panel, refreshed every tick;
//   2. a side effect: for each newly-funded company we probe Greenhouse/Lever/Ashby
//      for a live board and fold any hit into the shared AtsCompany watchlist, so
//      their postings flow into discovery/scoring through the existing pipeline.
//
// In-memory state (radar list + the per-process "already extracted" set) lives on
// globalThis — the single-instance store the rest of discovery already relies on
// (see CLAUDE.md). The durable artifact (a resolved board) is persisted in the
// AtsCompany table, so nothing important is lost on restart.

// India-focused feeds only — the radar is for the Indian market, so a global
// wire like TechCrunch is intentionally left out. Both are India startup desks;
// the LLM still drops the occasional non-India item these desks cover.
const FEEDS: { source: string; url: string }[] = [
  { source: "inc42", url: "https://inc42.com/feed/" },
  { source: "yourstory", url: "https://yourstory.com/feed" },
];

// Only headlines that look like a funding event reach the (paid) LLM step.
const FUNDING_RE = /\b(raises?|raised|funding|fund|secures?|bags?|series\s+[a-e]\b|seed|pre-seed|round|valuation|backed|investment)\b|\$|₹/i;
const MAX_ITEMS_PER_FEED = 30;
const MAX_EXTRACTIONS_PER_RUN = 30; // hard cap on items sent to the LLM per tick
const LLM_BATCH = 10;
// Cap the board-probing fan-out so a busy funding week can't turn one tick into
// hundreds of HTTP requests.
const MAX_PROBES_PER_RUN = 20;
const PROBE_TIMEOUT_MS = 12_000;
// "Recently funded" = raised within the last couple of months. Anything older is
// stale for hiring purposes and gets dropped (before the LLM step, and pruned
// from the accumulated radar).
const RECENT_DAYS = 75;
const RECENT_MS = RECENT_DAYS * 86400 * 1000;
const RADAR_MAX = 60; // safety cap on radar size (the recency window is the real bound)

// Within the recency window? Items with no/!unparseable date are kept (the feeds
// list recent posts, so a missing date isn't evidence of being old).
function isRecent(date: string | undefined): boolean {
  if (!date) return true;
  const t = new Date(date).getTime();
  return isNaN(t) || Date.now() - t <= RECENT_MS;
}

export interface FundedCompany {
  company: string;
  amount: string; // as written, e.g. "$12 Mn" / "₹2,500 Cr"
  round: string; // "Seed" | "Series A" | "" ...
  sector: string;
  india: boolean;
  source: string; // feed key
  url: string; // article link
  foundAt: string; // ISO
  ats: { ats: string; slug: string } | null; // set if a live board was resolved
}

interface RadarState {
  updatedAt: string | null;
  items: FundedCompany[];
  seen: Set<string>; // article URLs already extracted this process lifetime
  running: boolean;
}

const g = globalThis as unknown as { __fundingRadar?: RadarState };
function state(): RadarState {
  return (g.__fundingRadar ??= { updatedAt: null, items: [], seen: new Set(), running: false });
}

export function getFundingRadar(): {
  updatedAt: string | null;
  items: FundedCompany[];
  running: boolean;
} {
  const s = state();
  return { updatedAt: s.updatedAt, items: s.items, running: s.running };
}

// Fire-and-forget kick for a user-triggered refresh. runFundingScan sets the
// `running` flag synchronously (before its first await) and no-ops if a scan is
// already in flight, so this is safe to call repeatedly — it joins the in-flight
// run rather than starting a second one (the CLAUDE.md long-running pattern).
export function startFundingScan(): { alreadyRunning: boolean } {
  const alreadyRunning = state().running;
  if (!alreadyRunning) void runFundingScan().catch(() => {});
  return { alreadyRunning };
}

// ── RSS parsing ────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&amp;/g, "&");
}

function tag(body: string, name: string): string {
  const m = body.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : "";
}

interface FeedItem {
  source: string;
  title: string;
  url: string;
  summary: string;
  pubDate?: string;
}

async function fetchFeed(feed: (typeof FEEDS)[number]): Promise<FeedItem[]> {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${feed.source} returned HTTP ${res.status}`);
  const xml = await res.text();
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const title = tag(body, "title");
    const url = tag(body, "link") || tag(body, "guid");
    if (!title || !url) continue;
    items.push({
      source: feed.source,
      title,
      url,
      summary: htmlToText(tag(body, "description")).slice(0, 600),
      pubDate: tag(body, "pubDate") || undefined,
    });
    if (items.length >= MAX_ITEMS_PER_FEED) break;
  }
  return items;
}

// ── LLM extraction ───────────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `You read startup/tech funding news items and extract the SINGLE company that just raised money.

Only emit an entry when the item reports a specific company closing a funding round (seed, pre-seed, Series A-E, bridge, debt, etc.). SKIP weekly/monthly roundups that name no single raiser, opinion pieces, product launches, M&A, IPO chatter, and anything not about a company raising capital.

For each qualifying item return:
- id: the item id given
- company: the company that raised (clean legal/brand name, no "raises ...")
- amount: the amount exactly as written (e.g. "$12 Mn", "₹250 Cr"), else ""
- round: the round label if stated (e.g. "Seed", "Series A"), else ""
- sector: a 1-3 word sector (e.g. "fintech", "dev tools", "logistics")
- tech: true ONLY if the company's core product is software/technology — SaaS, AI/ML, dev tools, fintech, edtech, consumer apps/marketplaces, cybersecurity, data, deeptech/robotics, or healthtech/biotech that is clearly built on software or AI. false for pure pharma/drug discovery, hospitals/clinics/diagnostics-only, traditional D2C/FMCG/retail, real estate, lending/NBFCs with no tech product, and manufacturing with no software core. When unsure, false.
- india: true if the company is India-based or India-headquartered

Output STRICT JSON: {"events": [{"id":"...","company":"...","amount":"...","round":"...","sector":"...","tech":true,"india":true}]}`;

interface ExtractedEvent {
  id: string;
  company: string;
  amount: string;
  round: string;
  sector: string;
  tech: boolean;
  india: boolean;
}

// The model returns {"events": [...]}, but that JSON is untrusted: `events` may
// be missing or not an array, entries may not be objects, required fields may be
// absent, and booleans often come back as the strings "true"/"false". Coerce the
// raw array into validated ExtractedEvent objects and drop anything unusable —
// never read the model's shape directly downstream.
function coerceBool(v: unknown, dflt: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "yes" || t === "1") return true;
    if (t === "false" || t === "no" || t === "0") return false;
  }
  return dflt;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function validateEvents(raw: unknown): ExtractedEvent[] {
  const arr = (raw as { events?: unknown } | null)?.events;
  if (!Array.isArray(arr)) return [];
  const events: ExtractedEvent[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const company = asString(o.company);
    if (!company) continue; // a funding event with no company is unusable
    events.push({
      id: asString(o.id),
      company,
      amount: asString(o.amount),
      round: asString(o.round),
      sector: asString(o.sector),
      // Missing flag → keep (the feeds are India tech desks); only an explicit
      // false drops the entry.
      tech: coerceBool(o.tech, true),
      india: coerceBool(o.india, true),
    });
  }
  return events;
}

// ── ATS board probing ──────────────────────────────────────────────────────────

function slugVariants(company: string): string[] {
  const base = company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|pvt|private|limited|technologies|technology|labs|software|solutions)\b/g, "")
    .trim();
  const compact = base.replace(/[^a-z0-9]/g, "");
  const hyphen = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [...new Set([compact, hyphen].filter((s) => s.length >= 3))];
}

const BOARD_URL: Record<string, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
};

// Returns the first {ats, slug} whose public board is live with >=1 posting.
async function resolveBoard(company: string): Promise<{ ats: string; slug: string } | null> {
  for (const slug of slugVariants(company)) {
    for (const ats of Object.keys(BOARD_URL)) {
      try {
        const res = await fetch(BOARD_URL[ats](slug), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (!res.ok) continue;
        const json = (await res.json()) as { jobs?: unknown[] } | unknown[];
        const count = Array.isArray(json) ? json.length : (json.jobs?.length ?? 0);
        if (count > 0) return { ats, slug };
      } catch {
        // dead/unknown board — try the next variant
      }
    }
  }
  return null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface FundingScanResult {
  extracted: number; // qualifying funding events parsed this run
  newBoards: number; // companies folded into the ATS watchlist this run
  total: number; // radar size after the run
}

// Best-effort: never throw into the caller (the global tick swallows failures and
// keeps the previous radar). Joins-in-flight via the `running` flag so two ticks
// can't double-extract.
export async function runFundingScan(): Promise<FundingScanResult> {
  const s = state();
  if (s.running) return { extracted: 0, newBoards: 0, total: s.items.length };
  if (!process.env.DEEPSEEK_API_KEY) return { extracted: 0, newBoards: 0, total: s.items.length };
  s.running = true;
  try {
    // 1. Gather candidate items across feeds (failures per-feed are non-fatal).
    const feeds = await Promise.all(
      FEEDS.map((f) => fetchFeed(f).catch(() => [] as FeedItem[]))
    );
    const candidates = feeds
      .flat()
      .filter((it) => FUNDING_RE.test(`${it.title} ${it.summary}`))
      .filter((it) => isRecent(it.pubDate)) // only the last couple of months
      .filter((it) => !s.seen.has(it.url))
      .slice(0, MAX_EXTRACTIONS_PER_RUN);
    if (candidates.length === 0) return { extracted: 0, newBoards: 0, total: s.items.length };

    // 2. LLM-extract the structured funding event from each.
    const fresh: FundedCompany[] = [];
    for (let i = 0; i < candidates.length; i += LLM_BATCH) {
      const batch = candidates.slice(i, i + LLM_BATCH);
      batch.forEach((it) => s.seen.add(it.url));
      const user = batch
        .map((it, j) => `## ITEM id=${i + j}\nTITLE: ${it.title}\nSUMMARY: ${it.summary}`)
        .join("\n\n");
      let raw: unknown;
      try {
        raw = await chatJson<unknown>({
          apiKey: serverApiKey(),
          system: EXTRACT_SYSTEM,
          user: `${user}\n\n# TASK\nExtract funding events from the items above.`,
          temperature: 0.2,
          maxTokens: 4096,
        });
      } catch {
        continue; // one bad batch shouldn't sink the run
      }
      // Validate the model's JSON array into typed objects before using it.
      for (const ev of validateEvents(raw)) {
        const item = batch[Number(ev.id) - i];
        // Tech-only and India-only: skip non-software companies and anything the
        // model flags as non-India (these India desks occasionally cover global
        // raises).
        if (!item || !ev.tech || !ev.india) continue;
        if (!isRecent(item.pubDate)) continue; // older than the recency window
        fresh.push({
          company: ev.company,
          amount: ev.amount,
          round: ev.round,
          sector: ev.sector,
          india: true,
          source: item.source,
          url: item.url,
          foundAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          ats: null,
        });
      }
    }

    // 3. Probe boards for the freshly-funded companies; fold live ones into the
    //    shared watchlist (capped). Done concurrently with a small pool.
    let newBoards = 0;
    const toProbe = fresh.slice(0, MAX_PROBES_PER_RUN);
    await Promise.all(
      toProbe.map(async (fc) => {
        const board = await resolveBoard(fc.company);
        if (!board) return;
        fc.ats = board;
        const existing = await prisma.atsCompany.findUnique({
          where: { ats_slug: { ats: board.ats, slug: board.slug } },
        });
        await prisma.atsCompany.upsert({
          where: { ats_slug: { ats: board.ats, slug: board.slug } },
          create: { ats: board.ats, slug: board.slug, name: fc.company },
          update: {}, // don't clobber an existing board's name/health
        });
        if (!existing) newBoards++;
      })
    );

    // 4. Merge into the radar, deduped by company (two outlets often cover the
    //    same raise) keeping the richest record, newest first, capped.
    const dedup = new Map<string, FundedCompany>();
    for (const fc of [...fresh, ...s.items]) {
      const key = fc.company.toLowerCase().replace(/[^a-z0-9]/g, "");
      const prev = dedup.get(key);
      if (!prev) {
        dedup.set(key, fc);
        continue;
      }
      // Prefer the entry that resolved a board, then one flagged India, then the
      // one carrying an amount — but keep the earliest foundAt so it doesn't churn.
      const richer =
        (fc.ats && !prev.ats) ||
        (!!fc.ats === !!prev.ats && fc.india && !prev.india) ||
        (!!fc.ats === !!prev.ats && fc.india === prev.india && fc.amount && !prev.amount);
      if (richer) dedup.set(key, { ...fc, foundAt: prev.foundAt });
    }
    s.items = [...dedup.values()]
      .filter((fc) => isRecent(fc.foundAt)) // prune accumulated raises past the window
      .sort((a, b) => new Date(b.foundAt).getTime() - new Date(a.foundAt).getTime())
      .slice(0, RADAR_MAX);
    s.updatedAt = new Date().toISOString();

    return { extracted: fresh.length, newBoards, total: s.items.length };
  } finally {
    s.running = false;
  }
}
