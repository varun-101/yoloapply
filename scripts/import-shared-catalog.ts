// One-off: rebuild the global JobLead catalog + per-user UserLead overlays from
// data/leads-export.json (the per-user rows captured before the shared-catalog
// migration). Run AFTER `prisma migrate deploy` + `prisma generate`.
//
//   npx tsx scripts/import-shared-catalog.ts
//
// Idempotent-ish: wipes JobLead/UserLead first so it can be re-run safely.
try {
  process.loadEnvFile(".env");
} catch {}
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const prisma = new PrismaClient();

interface OldLead {
  id: string;
  userId: string;
  source: string;
  externalId: string;
  sources: string | null;
  company: string;
  role: string;
  location: string | null;
  url: string | null;
  canonicalUrl: string | null;
  jdText: string | null;
  salary: string | null;
  jobType: string | null;
  experience: string | null;
  skills: string | null;
  postedAt: string | null;
  contactEmail: string | null;
  score: number | null;
  scoreReason: string | null;
  status: string;
  applicationId: string | null;
  scanRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Merge b's value into a when a is empty (first non-null wins after canonical).
function coalesce<T>(a: T | null, b: T | null): T | null {
  return a ?? b;
}

async function main() {
  const rows: OldLead[] = JSON.parse(readFileSync("data/leads-export.json", "utf8"));
  console.log(`loaded ${rows.length} exported rows`);

  // 1. Mark the admin: the account that has a UserProfile is the main account.
  const main = await prisma.user.findFirst({
    where: { profile: { isNot: null } },
    select: { id: true, email: true },
  });
  if (!main) throw new Error("no account with a profile found — cannot pick an admin");
  await prisma.user.update({ where: { id: main.id }, data: { isAdmin: true } });
  console.log(`admin set: ${main.email}`);

  // 2. Group exported rows by (source, externalId); oldest row is canonical.
  const groups = new Map<string, OldLead[]>();
  for (const r of rows) {
    const key = `${r.source}::${r.externalId}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  // 3. Build deduped catalog rows. The canonical's id becomes the catalog id so
  //    the per-row UserLeads can reference it without a returned-id round trip.
  const catalog: Record<string, unknown>[] = [];
  const groupToCatalogId = new Map<string, string>();
  for (const [key, members] of groups) {
    members.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const c = members[0];
    groupToCatalogId.set(key, c.id);
    // Union the multi-source labels, fill any missing posting facts from siblings.
    const sourceSet = new Set<string>();
    for (const m of members) {
      for (const s of (m.sources ?? m.source).split(",")) if (s) sourceSet.add(s.trim());
    }
    let merged: OldLead = { ...c };
    for (const m of members.slice(1)) {
      merged = {
        ...merged,
        location: coalesce(merged.location, m.location),
        url: coalesce(merged.url, m.url),
        canonicalUrl: coalesce(merged.canonicalUrl, m.canonicalUrl),
        jdText: coalesce(merged.jdText, m.jdText),
        salary: coalesce(merged.salary, m.salary),
        jobType: coalesce(merged.jobType, m.jobType),
        experience: coalesce(merged.experience, m.experience),
        skills: coalesce(merged.skills, m.skills),
        contactEmail: coalesce(merged.contactEmail, m.contactEmail),
        postedAt: coalesce(merged.postedAt, m.postedAt),
      };
    }
    catalog.push({
      id: c.id,
      source: merged.source,
      externalId: merged.externalId,
      sources: sourceSet.size > 1 ? [...sourceSet].join(",") : null,
      company: merged.company,
      role: merged.role,
      location: merged.location,
      url: merged.url,
      canonicalUrl: merged.canonicalUrl,
      jdText: merged.jdText,
      salary: merged.salary,
      jobType: merged.jobType,
      experience: merged.experience,
      skills: merged.skills,
      postedAt: merged.postedAt ? new Date(merged.postedAt) : null,
      contactEmail: merged.contactEmail,
      createdAt: new Date(merged.createdAt),
      updatedAt: new Date(merged.updatedAt),
    });
  }
  console.log(`deduped ${rows.length} rows -> ${catalog.length} catalog entries`);

  // Which scanRunIds still exist (FK-safe before we reference them on UserLead).
  const scanRuns = await prisma.scanRun.findMany({ select: { id: true } });
  const validScanRuns = new Set(scanRuns.map((s) => s.id));

  // 4. UserLead overlay rows — one per exported row, preserving status/score/app.
  const overlays = rows.map((r) => ({
    userId: r.userId,
    jobLeadId: groupToCatalogId.get(`${r.source}::${r.externalId}`)!,
    status: r.status,
    applicationId: r.applicationId,
    score: r.score,
    scoreReason: r.scoreReason,
    scanRunId: r.scanRunId && validScanRuns.has(r.scanRunId) ? r.scanRunId : null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));

  // 5. Wipe + reload.
  await prisma.userLead.deleteMany({});
  await prisma.jobLead.deleteMany({});
  await prisma.jobLead.createMany({ data: catalog as never });
  // createMany has row-count limits on some drivers; chunk the overlays.
  for (let i = 0; i < overlays.length; i += 1000) {
    await prisma.userLead.createMany({ data: overlays.slice(i, i + 1000) as never });
  }

  const jl = await prisma.jobLead.count();
  const ul = await prisma.userLead.count();
  console.log(`done: ${jl} catalog rows, ${ul} overlay rows`);
}

main().finally(() => prisma.$disconnect());
