// One-off cleanup: collapse pre-existing duplicate JobLead rows in the shared
// catalog — the same posting that was ingested more than once before the
// company+role fingerprint dedupe (src/lib/discovery/pipeline.ts) existed.
//
// Groups the catalog by fingerprint, keeps one row per group (preferring one
// with a JD, else the oldest), merges source labels + JD/contact onto the
// keeper, repoints every UserLead overlay to the keeper (resolving the
// [userId, jobLeadId] unique conflict by keeping the strongest status/score),
// then deletes the now-empty duplicate rows.
//
// Run:  npx tsx scripts/dedupe-catalog.ts            (apply)
//       npx tsx scripts/dedupe-catalog.ts --dry-run  (report only)

import { prisma } from "../src/lib/db";
import { dedupeFingerprint, REPOST_WINDOW_MS } from "../src/lib/discovery/pipeline";

try {
  process.loadEnvFile(".env");
} catch {
  // .env optional — env vars may come from the environment.
}

const DRY_RUN = process.argv.includes("--dry-run");

type Lead = Awaited<ReturnType<typeof loadLeads>>[number];
type UserLead = Lead["userLeads"][number];

function loadLeads() {
  return prisma.jobLead.findMany({
    select: {
      id: true,
      company: true,
      role: true,
      source: true,
      sources: true,
      jdText: true,
      contactEmail: true,
      postedAt: true,
      createdAt: true,
      userLeads: {
        select: { id: true, userId: true, status: true, applicationId: true, score: true, scoreReason: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

const statusRank = (s: string) => (s === "promoted" ? 3 : s === "dismissed" ? 2 : 1);

// The date a posting is reckoned by for the repost window: posting date when
// known, else the date we found it.
const effDate = (l: Lead) => l.postedAt ?? l.createdAt;

// Split one fingerprint group into date-bounded clusters: sorted oldest-first,
// each cluster anchors on its first row and absorbs later rows within the
// repost window of that anchor; a row beyond the window opens a new cluster.
// Mirrors how live ingest anchors merges on an existing row.
function dateClusters(group: Lead[]): Lead[][] {
  const sorted = [...group].sort((a, b) => effDate(a).getTime() - effDate(b).getTime());
  const clusters: Lead[][] = [];
  let cluster: Lead[] = [];
  let anchor = 0;
  for (const l of sorted) {
    if (cluster.length === 0) {
      cluster = [l];
      anchor = effDate(l).getTime();
    } else if (effDate(l).getTime() - anchor <= REPOST_WINDOW_MS) {
      cluster.push(l);
    } else {
      clusters.push(cluster);
      cluster = [l];
      anchor = effDate(l).getTime();
    }
  }
  if (cluster.length > 0) clusters.push(cluster);
  return clusters;
}

// Pick the keeper: a row that already has a JD beats one without; ties broken by
// age (oldest first — it carries the most history / earliest createdAt).
function pickKeeper(group: Lead[]): Lead {
  return [...group].sort((a, b) => {
    const aJd = a.jdText ? 1 : 0;
    const bJd = b.jdText ? 1 : 0;
    if (aJd !== bJd) return bJd - aJd;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

function mergedSources(group: Lead[]): string {
  const labels = new Set<string>();
  for (const l of group) for (const s of (l.sources ?? l.source).split(",")) if (s) labels.add(s);
  return [...labels].join(",");
}

// Combine two overlays for the same user into the fields the survivor should keep.
function mergeUserLead(keep: UserLead, other: UserLead): Partial<UserLead> {
  const status = statusRank(other.status) > statusRank(keep.status) ? other.status : keep.status;
  const applicationId =
    keep.status === "promoted"
      ? keep.applicationId
      : other.status === "promoted"
      ? other.applicationId
      : keep.applicationId ?? other.applicationId;
  let score = keep.score;
  let scoreReason = keep.scoreReason;
  if (other.score != null && (score == null || other.score > score)) {
    score = other.score;
    scoreReason = other.scoreReason;
  }
  return { status, applicationId, score, scoreReason };
}

async function main() {
  const leads = await loadLeads();

  const groups = new Map<string, Lead[]>();
  for (const l of leads) {
    const fp = dedupeFingerprint(l.company, l.role);
    if (!fp) continue; // rows with a blank company/role can't be safely merged
    (groups.get(fp) ?? groups.set(fp, []).get(fp)!).push(l);
  }

  // A fingerprint group only merges within the repost window — split it into
  // date-bounded clusters, each of which collapses to one keeper.
  const clusters: Lead[][] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const cluster of dateClusters(group)) if (cluster.length >= 2) clusters.push(cluster);
  }

  let dupeGroups = 0;
  let removed = 0;
  let overlapsMerged = 0;

  for (const group of clusters) {
    dupeGroups++;
    const keeper = pickKeeper(group);
    const dups = group.filter((l) => l.id !== keeper.id);

    const newSources = mergedSources(group);
    const newJd = keeper.jdText ?? dups.find((d) => d.jdText)?.jdText ?? null;
    const newContact = keeper.contactEmail ?? dups.find((d) => d.contactEmail)?.contactEmail ?? null;

    console.log(
      `· ${keeper.company} — ${keeper.role}: keep ${keeper.id} (${newSources}), remove ${dups.length} dup(s)`
    );

    if (DRY_RUN) {
      removed += dups.length;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      // Survivor overlays for this group, keyed by user — seeded from the keeper.
      const survivors = new Map<string, UserLead>();
      for (const ul of keeper.userLeads) survivors.set(ul.userId, ul);

      for (const dup of dups) {
        for (const ul of dup.userLeads) {
          const survivor = survivors.get(ul.userId);
          if (!survivor) {
            // No keeper overlay for this user yet — repoint this one onto the keeper.
            await tx.userLead.update({ where: { id: ul.id }, data: { jobLeadId: keeper.id } });
            survivors.set(ul.userId, ul);
            continue;
          }
          // Conflict: both rows have an overlay for this user. Fold the dup's
          // status/score into the survivor, then drop the dup overlay.
          const merged = mergeUserLead(survivor, ul);
          await tx.userLead.update({ where: { id: survivor.id }, data: merged });
          await tx.userLead.delete({ where: { id: ul.id } });
          Object.assign(survivor, merged);
          overlapsMerged++;
        }
      }

      await tx.jobLead.update({
        where: { id: keeper.id },
        data: { sources: newSources, jdText: newJd, contactEmail: newContact },
      });
      // UserLeads have been repointed off the dups; deleting them is now safe.
      await tx.jobLead.deleteMany({ where: { id: { in: dups.map((d) => d.id) } } });
    });

    removed += dups.length;
  }

  console.log(
    `\n${DRY_RUN ? "[dry run] " : ""}${dupeGroups} duplicate group(s), ${removed} row(s) ${
      DRY_RUN ? "would be removed" : "removed"
    }, ${overlapsMerged} overlapping overlay(s) merged.`
  );
}

main()
  .catch((e) => {
    console.error("dedupe-catalog failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
