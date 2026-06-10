import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sourceTier } from "@/lib/discovery/types";

export type LeadSort = "trust" | "newest" | "oldest" | "score" | "company";

// The DB orderBy only decides which rows survive the 500-row cap — the exact
// ordering (incl. trust tier, which lives in code) happens in JS below.
const DB_ORDER: Record<LeadSort, Prisma.JobLeadOrderByWithRelationInput[]> = {
  trust: [{ postedAt: "desc" }, { createdAt: "desc" }],
  newest: [{ postedAt: "desc" }, { createdAt: "desc" }],
  oldest: [{ postedAt: "asc" }, { createdAt: "asc" }],
  score: [{ score: { sort: "desc", nulls: "last" } }, { postedAt: "desc" }],
  company: [{ company: "asc" }, { postedAt: "desc" }],
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "new";
  const source = sp.get("source");
  const jobType = sp.get("jobType");
  const days = Number(sp.get("days") ?? 0);
  const sortParam = sp.get("sort") ?? "trust";
  const sort: LeadSort = sortParam in DB_ORDER ? (sortParam as LeadSort) : "trust";

  const where: Record<string, unknown> = {};
  if (status !== "all") where.status = status;
  if (source) {
    // Match the primary source or any extra source recorded on the lead.
    where.OR = [{ source }, { sources: { contains: source } }];
  }
  if (jobType) where.jobType = jobType;
  if (days > 0) {
    where.postedAt = { gte: new Date(Date.now() - days * 86400 * 1000) };
  }

  const leads = await prisma.jobLead.findMany({
    where,
    orderBy: DB_ORDER[sort],
    take: 500,
  });

  const date = (l: (typeof leads)[number]) => l.postedAt?.getTime() ?? l.createdAt.getTime();
  switch (sort) {
    case "newest":
      leads.sort((a, b) => date(b) - date(a));
      break;
    case "oldest":
      leads.sort((a, b) => date(a) - date(b));
      break;
    case "score":
      // Unscored leads sink to the bottom rather than mixing in at zero.
      leads.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || date(b) - date(a));
      break;
    case "company":
      leads.sort((a, b) => a.company.localeCompare(b.company) || date(b) - date(a));
      break;
    default:
      // Trusted sources first, newest within each tier.
      leads.sort((a, b) => {
        const t = sourceTier(a.source) - sourceTier(b.source);
        if (t !== 0) return t;
        return date(b) - date(a);
      });
  }

  return NextResponse.json(leads);
}
