import { prisma } from "../db";
import { fetchAtsLeads } from "./ats";
import { fetchHnLeads } from "./hn";
import { fetchJobfoundLeads } from "./jobfound";
import { fetchSheetLeads } from "./sheet";
import { scoreNewLeads } from "./score";
import type { RawLead } from "./types";

// Params that only track where a click came from. Everything else (ATS tokens,
// posting ids) must survive canonicalization or Greenhouse-style embed URLs
// would all collapse into one.
const TRACKING_PARAMS = new Set([
  "src",
  "source",
  "gh_src",
  "ref",
  "trk",
  "trackingid",
  "alternatechannel",
  "ebp",
  "lipi",
]);

export function canonicalizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        u.searchParams.delete(key);
      }
    }
    u.searchParams.sort();
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function normKey(company: string, role: string): string {
  return `${company}::${role}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface SourceStats {
  source: string;
  fetched: number;
  created: number;
  duplicates: number;
  alreadyApplied: number;
  error?: string;
}

export interface DiscoveryRunResult {
  sources: SourceStats[];
  created: number;
  scored: number;
  scoreError?: string;
}

export async function runDiscovery(): Promise<DiscoveryRunResult> {
  const [sheet, jobfound, ats, hn] = await Promise.all([
    fetchSheetLeads(),
    fetchJobfoundLeads(),
    fetchAtsLeads(),
    fetchHnLeads(),
  ]);
  const results = [sheet, jobfound, ...ats, hn];

  const [existingLeads, applications] = await Promise.all([
    prisma.jobLead.findMany({
      select: { id: true, source: true, externalId: true, canonicalUrl: true, sources: true },
    }),
    prisma.application.findMany({ select: { company: true, role: true, applyUrl: true } }),
  ]);

  const seenSourceIds = new Set(existingLeads.map((l) => `${l.source}::${l.externalId}`));
  const byCanonical = new Map<string, { id: string; sources: string | null; source: string }>();
  for (const l of existingLeads) {
    if (l.canonicalUrl) byCanonical.set(l.canonicalUrl, l);
  }
  const appliedUrls = new Set(
    applications.map((a) => canonicalizeUrl(a.applyUrl ?? undefined)).filter(Boolean)
  );
  const appliedKeys = new Set(applications.map((a) => normKey(a.company, a.role)));

  const stats: SourceStats[] = [];
  let createdTotal = 0;

  for (const result of results) {
    const s: SourceStats = {
      source: result.source,
      fetched: result.leads.length,
      created: 0,
      duplicates: 0,
      alreadyApplied: 0,
      error: result.error,
    };

    for (const lead of result.leads) {
      const sourceKey = `${lead.source}::${lead.externalId}`;
      if (seenSourceIds.has(sourceKey)) {
        s.duplicates++;
        continue;
      }
      seenSourceIds.add(sourceKey);

      const canonical = canonicalizeUrl(lead.url);

      // Same posting already ingested from another source — record the extra
      // source on the existing lead instead of duplicating it.
      const cross = canonical ? byCanonical.get(canonical) : undefined;
      if (cross) {
        const sources = cross.sources ?? cross.source;
        if (!sources.split(",").includes(lead.source)) {
          await prisma.jobLead.update({
            where: { id: cross.id },
            data: { sources: `${sources},${lead.source}` },
          });
          cross.sources = `${sources},${lead.source}`;
        }
        s.duplicates++;
        continue;
      }

      // Already-applied guard: skip postings matching an existing application.
      if ((canonical && appliedUrls.has(canonical)) || appliedKeys.has(normKey(lead.company, lead.role))) {
        s.alreadyApplied++;
        continue;
      }

      const created = await prisma.jobLead.create({
        data: {
          source: lead.source,
          externalId: lead.externalId,
          company: lead.company,
          role: lead.role,
          location: lead.location ?? null,
          url: lead.url ?? null,
          canonicalUrl: canonical ?? null,
          jdText: lead.jdText ?? null,
          salary: lead.salary ?? null,
          jobType: lead.jobType ?? null,
          experience: lead.experience ?? null,
          skills: lead.skills ?? null,
          contactEmail: lead.contactEmail ?? null,
          postedAt: lead.postedAt ?? null,
        },
      });
      if (canonical) {
        byCanonical.set(canonical, { id: created.id, sources: null, source: lead.source });
      }
      s.created++;
      createdTotal++;
    }

    stats.push(s);
  }

  const scoring = await scoreNewLeads();

  return {
    sources: stats,
    created: createdTotal,
    scored: scoring.scored,
    scoreError: scoring.error,
  };
}

export type { RawLead };
