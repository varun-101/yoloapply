import { prisma } from "../db";
import { getApolloKey, getSearchKey, getSignalHireKey } from "../credentials";
import { getLlmConfigOrNull } from "../credentials";
import { resolveCompanyDomain, registrableDomain } from "./domain";
import { hasMx, isPlausibleEmail } from "./verify";
import { inferCompanyPattern, guessEmails } from "./resolve";
import { mergeAndRank } from "./rank";
import { fetchSiteContacts } from "./lanes/site";
import { fetchGithubContacts } from "./lanes/github";
import { fetchRoleInboxes } from "./lanes/roleInbox";
import { fetchApolloContacts } from "./lanes/apollo";
import { fetchSignalHireContacts } from "./lanes/signalhire";
import { fetchPortfolioContacts } from "./lanes/portfolio";
import type { LaneResult, RankedContact, RawCandidate } from "./types";
import { createHash } from "crypto";

// Orchestrates the contact-finder lanes. Mirrors the discovery pipeline's
// guarantees (CLAUDE.md "robust long-running operations"):
//   • Backend owns the lifecycle — the API route kicks this off and returns; the
//     run continues regardless of the client, and its outcome is persisted on the
//     domain-keyed CompanyContactCache row (status/error/contacts).
//   • Idempotent — a second kick for the same domain joins the in-flight run
//     (process-level lock) and, across instances, the DB status='running' guard.
//   • Status & results are DB-backed, so the UI can poll and restore on reload.
// Caveat (same as discovery): the in-flight Map lives on globalThis and assumes a
// SINGLE instance; the DB status row is the cross-instance backstop.

const FRESH_MS = 14 * 24 * 60 * 60 * 1000; // re-enrich a domain at most every 14 days
const MAX_PATTERN_PEOPLE = 15; // cap name-only people we pattern-guess/portfolio-resolve

export interface EnrichInput {
  userId: string;
  company: string;
  urls?: (string | null | undefined)[]; // candidate URLs to derive the domain from
  fallbackUrls?: (string | null | undefined)[]; // tried only if name resolution fails
  domain?: string | null; // explicit override (skips resolution)
  leadEmails?: string[]; // emails already attached to the lead (HN contactEmail)
  leadRecruiter?: LeadRecruiter | null; // the person named on the listing itself
  force?: boolean;
  searchLocation?: string | null;
}

// The recruiter a job listing names. `company` is theirs, not necessarily the
// employer's — staffing agencies handle a large share of Indian postings.
export interface LeadRecruiter {
  name: string;
  title?: string | null;
  company?: string | null;
}

export interface SourceDiagnostic {
  found: number;
  status?: string;
  error?: string;
  creditsRemaining?: string;
}

export interface EnrichStatus {
  domain: string | null;
  company: string;
  status: "idle" | "running" | "completed" | "failed" | "no_domain";
  pattern: string | null;
  error: string | null;
  enrichedAt: string | null;
  contacts: RankedContact[];
  searchLocation: string | null;
  sourceStats: Record<string, SourceDiagnostic>;
}

type EnrichGlobal = { __contactEnrich?: Map<string, Promise<void>> };
const g = globalThis as unknown as EnrichGlobal;
function inflight(): Map<string, Promise<void>> {
  return (g.__contactEnrich ??= new Map());
}

function normalizeDomain(raw: string): string {
  return registrableDomain(raw.replace(/^https?:\/\//, "").split("/")[0].trim().toLowerCase());
}

function normalizeLocation(value?: string | null): string | null {
  return value?.trim().replace(/\s+/g, " ") || null;
}

// Is the recruiter's employer the company we're hiring at? "Acme Technologies
// Pvt. Ltd." and "Acme" are the same place; "Success Pact" is not. Ties break
// toward "different", which only ever costs us an email guess we shouldn't have
// made anyway.
function sameEmployer(a: string, b: string): boolean {
  const strip = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(pvt|private|ltd|limited|inc|llp|llc|corp|corporation|technologies|technology|solutions|consulting|india)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  const [x, y] = [strip(a), strip(b)];
  // Names made up entirely of stripped words normalize to "" — compare raw.
  if (!x || !y) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return x === y;
}

function intentKey(userId: string, domain: string, location?: string | null): string {
  return createHash("sha256")
    .update(`${userId}|${domain}|${normalizeLocation(location)?.toLowerCase() ?? "global"}`)
    .digest("hex");
}

function rowToStatus(
  row: {
    domain: string;
    company: string | null;
    status: string;
    pattern: string | null;
    error: string | null;
    enrichedAt: Date | null;
    searchLocation: string | null;
    sourceStats: string | null;
  },
  contacts: RankedContact[]
): EnrichStatus {
  return {
    domain: row.domain,
    company: row.company ?? "",
    status: row.status as EnrichStatus["status"],
    pattern: row.pattern,
    error: row.error,
    enrichedAt: row.enrichedAt ? row.enrichedAt.toISOString() : null,
    searchLocation: row.searchLocation,
    sourceStats: (() => {
      try {
        return row.sourceStats ? (JSON.parse(row.sourceStats) as Record<string, SourceDiagnostic>) : {};
      } catch {
        return {};
      }
    })(),
    contacts,
  };
}

async function loadStatus(key: string): Promise<EnrichStatus | null> {
  const row = await prisma.companyContactCache.findUnique({
    where: { intentKey: key },
    include: { contacts: { orderBy: { rank: "desc" } } },
  });
  if (!row) return null;
  const contacts: RankedContact[] = row.contacts.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    title: c.title,
    email: c.email,
    linkedinUrl: c.linkedinUrl,
    location: c.location,
    providerPersonId: c.providerPersonId,
    contactStatus: c.contactStatus,
    source: c.source as RankedContact["source"],
    sources: c.sources,
    confidence: c.confidence,
    verified: c.verified,
    verifyMethod: c.verifyMethod,
    seniorityRank: c.seniorityRank,
    skipResolve: c.skipResolve,
    rank: c.rank,
  }));
  return rowToStatus(row, contacts);
}

// GET handler reads this — purely from the DB, so it works on any instance and
// after a reload.
export async function getEnrichStatusByDomain(
  domain: string,
  userId: string,
  searchLocation?: string | null
): Promise<EnrichStatus | null> {
  const normalized = normalizeDomain(domain);
  return loadStatus(intentKey(userId, normalized, searchLocation));
}

// Kick-off used by POST. Resolves the domain, joins/serves a fresh-or-running
// cache, otherwise marks the row running and starts the background run.
export async function startEnrich(input: EnrichInput): Promise<EnrichStatus> {
  const resolved = input.domain
    ? { domain: normalizeDomain(input.domain), via: "url" as const }
    : await resolveCompanyDomain({
        company: input.company,
        urls: input.urls,
        fallbackUrls: input.fallbackUrls,
      });

  if (!resolved.domain) {
    return {
      domain: null,
      company: input.company,
      status: "no_domain",
      pattern: null,
      error:
        "Couldn't determine the company's website domain. Add the company's site URL (e.g. in the application's JD URL) and try again.",
      enrichedAt: null,
      contacts: [],
      searchLocation: normalizeLocation(input.searchLocation),
      sourceStats: {},
    };
  }
  const domain = resolved.domain;
  const location = normalizeLocation(input.searchLocation);
  const key = intentKey(input.userId, domain, location);
  const existing = await loadStatus(key);

  const fresh =
    existing?.status === "completed" &&
    existing.enrichedAt &&
    Date.now() - new Date(existing.enrichedAt).getTime() < FRESH_MS;
  if (existing && (existing.status === "running" || (fresh && !input.force))) {
    return existing;
  }

  // Mark running synchronously so a concurrent GET/POST sees it (keeps prior
  // contacts visible until the new run replaces them).
  await prisma.companyContactCache.upsert({
    where: { intentKey: key },
    create: { domain, intentKey: key, ownerUserId: input.userId, searchLocation: location, company: input.company, status: "running", startedAt: new Date() },
    update: { status: "running", startedAt: new Date(), error: null, company: input.company, searchLocation: location },
  });

  const m = inflight();
  if (!m.has(key)) {
    const p = runEnrich(key, domain, input)
      .catch(() => {})
      .finally(() => m.delete(key));
    m.set(key, p);
  }
  return (await loadStatus(key))!;
}

// The actual lane fan-out + resolve + rank + persist. Updates the cache row to
// completed/failed at the end so the outcome survives no client listening.
async function runEnrich(key: string, domain: string, input: EnrichInput): Promise<void> {
  const cache = await prisma.companyContactCache.findUnique({ where: { intentKey: key } });
  if (!cache) return;
  try {
    const [apolloKey, signalhireKey, searchKey, llm] = await Promise.all([
      getApolloKey(input.userId),
      getSignalHireKey(input.userId),
      getSearchKey(input.userId),
      getLlmConfigOrNull(input.userId),
    ]);
    const company = input.company;

    // User-added LinkedIn profiles belong to this search intent and must survive
    // a provider refresh, unlike replaceable lane output.
    const manualCands: RawCandidate[] = (await prisma.discoveredContact.findMany({
      where: { cacheId: cache.id, source: "manual" },
    })).map((candidate) => ({
      name: candidate.name ?? undefined,
      title: candidate.title ?? undefined,
      email: candidate.email ?? undefined,
      phone: candidate.phone ?? undefined,
      linkedinUrl: candidate.linkedinUrl ?? undefined,
      location: candidate.location ?? undefined,
      providerPersonId: candidate.providerPersonId ?? undefined,
      source: "manual",
      confidence: candidate.confidence,
      verified: candidate.verified,
      contactStatus: candidate.contactStatus as RawCandidate["contactStatus"],
    }));

    // Emails already known from the lead are real, trusted addresses.
    const leadCands: RawCandidate[] = (input.leadEmails ?? [])
      .filter(isPlausibleEmail)
      .map((e) => ({ email: e.toLowerCase(), source: "lead", confidence: 0.85, verified: true, verifyMethod: "published" }));

    // The recruiter the listing itself names: no email, but a confirmed name +
    // title for the exact role, which beats anything a provider guesses about
    // who to contact. If they work for a staffing agency rather than the
    // employer, they're kept out of the domain-based resolution below.
    const listingCands: RawCandidate[] = [];
    if (input.leadRecruiter?.name) {
      const recruiter = input.leadRecruiter;
      const agency = recruiter.company?.trim() || null;
      const sameCompany = !agency || sameEmployer(agency, company);
      const title = [recruiter.title?.trim(), sameCompany ? null : agency].filter(Boolean).join(" · ");
      listingCands.push({
        name: recruiter.name.trim(),
        title: title || undefined,
        source: "listing",
        confidence: 0,
        skipResolve: !sameCompany,
      });
    }

    // Free lanes + Apollo, all in parallel; each is self-contained and never throws.
    const lanes: LaneResult[] = await Promise.all([
      fetchSiteContacts(domain),
      fetchGithubContacts(company, domain),
      fetchRoleInboxes(domain),
      apolloKey
        ? fetchApolloContacts(domain, company, apolloKey, input.searchLocation)
        : Promise.resolve<LaneResult>({ source: "apollo", candidates: [], status: "not_configured" }),
      signalhireKey
        ? fetchSignalHireContacts(company, signalhireKey, fetch, input.searchLocation)
        : Promise.resolve<LaneResult>({ source: "signalhire", candidates: [], status: "not_configured" }),
    ]);

    let all: RawCandidate[] = [...manualCands, ...leadCands, ...listingCands, ...lanes.flatMap((l) => l.candidates)];

    // Infer the company's email shape from any real (name,email) pairs we have,
    // so guesses for the rest of the company are far stronger than blind defaults.
    const pattern = inferCompanyPattern(all.map((c) => ({ name: c.name, email: c.email })), domain);

    // People located by NAME but without an email (Apollo-locked, GitHub no-email).
    const emailedNames = new Set(
      all.filter((c) => c.email && c.name).map((c) => c.name!.toLowerCase().replace(/[^a-z]/g, ""))
    );
    const nameOnly: RawCandidate[] = [];
    const seenNames = new Set<string>();
    for (const c of all) {
      if (c.email || !c.name || c.skipResolve) continue;
      if (c.source === "apollo" || c.source === "signalhire" || c.source === "manual") continue;
      const key = c.name.toLowerCase().replace(/[^a-z]/g, "");
      if (!key || seenNames.has(key) || emailedNames.has(key)) continue;
      seenNames.add(key);
      nameOnly.push(c);
    }
    const toResolve = nameOnly.slice(0, MAX_PATTERN_PEOPLE);
    const normName = (n?: string | null) => (n ?? "").toLowerCase().replace(/[^a-z]/g, "");

    // Portfolio lane FIRST: it finds REAL published personal emails, which beat a
    // pattern guess, so we run it before falling back to guessing. Gated on the
    // user's Serper key. Caps people internally.
    let portfolioError: string | undefined;
    if (searchKey && toResolve.length) {
      const portfolio = await fetchPortfolioContacts(
        toResolve.map((p) => ({ name: p.name!, title: p.title, linkedinUrl: p.linkedinUrl })),
        company,
        domain,
        searchKey,
        llm ?? undefined
      );
      all = all.concat(portfolio.candidates);
      portfolioError = portfolio.error;
    }
    const portfolioResolved = new Set(
      all.filter((c) => c.source === "portfolio" && c.name).map((c) => normName(c.name))
    );

    // Pattern-guess a single best address ONLY for people the portfolio lane
    // didn't resolve (avoids a redundant guess + portfolio pair for the same
    // person), and only if the domain can receive mail.
    if (toResolve.length && (await hasMx(domain))) {
      for (const person of toResolve) {
        if (portfolioResolved.has(normName(person.name))) continue;
        const guess = guessEmails(person.name, domain, pattern, 1)[0];
        if (!guess) continue;
        all.push({
          name: person.name,
          title: person.title,
          linkedinUrl: person.linkedinUrl,
          email: guess.email,
          source: "pattern",
          confidence: guess.confidence,
          verified: false,
          verifyMethod: "pattern",
        });
      }
    }

    const ranked = mergeAndRank(all, input.searchLocation);

    // Per-lane stats for the UI (how many each contributed + any soft errors).
    const stats: Record<string, SourceDiagnostic> = {};
    for (const l of lanes) {
      stats[l.source] = {
        found: l.candidates.length,
        status: l.status ?? (l.error ? "error" : "ok"),
        ...(l.error ? { error: l.error } : {}),
        ...(l.creditsRemaining ? { creditsRemaining: l.creditsRemaining } : {}),
      };
    }
    stats.lead = { found: leadCands.length };
    if (listingCands.length) stats.listing = { found: listingCands.length, status: "ok" };
    stats.manual = { found: manualCands.length, status: "ok" };
    if (searchKey) stats.portfolio = { found: all.filter((c) => c.source === "portfolio").length, error: portfolioError };

    // Replace this domain's discovered contacts atomically.
    await prisma.$transaction([
      prisma.discoveredContact.deleteMany({ where: { cacheId: cache.id } }),
      ...ranked.map((c) =>
        prisma.discoveredContact.create({
          data: {
            cacheId: cache.id,
            name: c.name,
            phone: c.phone,
            title: c.title,
            email: c.email,
            linkedinUrl: c.linkedinUrl,
            location: c.location,
            providerPersonId: c.providerPersonId,
            contactStatus: c.contactStatus,
            source: c.source,
            sources: c.sources,
            confidence: c.confidence,
            verified: c.verified,
            verifyMethod: c.verifyMethod,
            seniorityRank: c.seniorityRank,
            skipResolve: c.skipResolve,
            rank: c.rank,
          },
        })
      ),
    ]);

    await prisma.companyContactCache.update({
      where: { id: cache.id },
      data: {
        status: "completed",
        pattern,
        sourceStats: JSON.stringify(stats),
        error: null,
        enrichedAt: new Date(),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.companyContactCache
      .update({ where: { id: cache.id }, data: { status: "failed", error: msg.slice(0, 500) } })
      .catch(() => {});
  }
}
