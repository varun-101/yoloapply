import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sourceTier } from "@/lib/discovery/types";
import { requireUser, apiError } from "@/lib/auth";

export type LeadSort = "trust" | "newest" | "oldest" | "score" | "company";

// The shared catalog is the SAME list for every user; only the per-user overlay
// (status/score/application) differs. The DB orderBy just decides which rows
// survive the 500-row cap — the exact ordering happens in JS below (trust tier
// and the per-user score both live outside the JobLead columns).
const DB_ORDER: Prisma.JobLeadOrderByWithRelationInput[] = [
  { postedAt: "desc" },
  { createdAt: "desc" },
];

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "new";
    const source = sp.get("source");
    const jobType = sp.get("jobType");
    const days = Number(sp.get("days") ?? 0);
    const scannedDays = Number(sp.get("scannedDays") ?? 0);
    const sortParam = sp.get("sort") ?? "trust";
    const validSorts = ["trust", "newest", "oldest", "score", "company"];
    const sort: LeadSort = (validSorts.includes(sortParam) ? sortParam : "trust") as LeadSort;
    const scanRunId = sp.get("scanRunId");

    const where: Prisma.JobLeadWhereInput = {};
    if (source) where.OR = [{ source }, { sources: { contains: source } }];
    if (jobType) where.jobType = jobType;
    if (days > 0) {
      // Window on when it was posted, falling back to when we ingested it — many
      // sheet rows ship without a postedAt and would otherwise vanish.
      const since = new Date(Date.now() - days * 86400 * 1000);
      where.AND = [{ OR: [{ postedAt: { gte: since } }, { postedAt: null, createdAt: { gte: since } }] }];
    }
    // "Recently scanned" — when the catalog discovered the posting, regardless of
    // how old the posting itself is.
    if (scannedDays > 0) {
      where.createdAt = { gte: new Date(Date.now() - scannedDays * 86400 * 1000) };
    }

    // Per-user overlay filters. A scan-history view (scanRunId) shows the leads
    // that run scored for this user; otherwise filter by the user's status.
    if (scanRunId) {
      where.userLeads = { some: { userId: user.id, scanRunId } };
    } else if (status === "promoted" || status === "dismissed") {
      where.userLeads = { some: { userId: user.id, status } };
    } else if (status === "new") {
      // "new" = catalog rows the user hasn't promoted or dismissed.
      where.userLeads = { none: { userId: user.id, status: { in: ["promoted", "dismissed"] } } };
    } // status === "all" → no overlay filter

    const rows = await prisma.jobLead.findMany({
      where,
      orderBy: DB_ORDER,
      take: 500,
      include: {
        userLeads: {
          where: { userId: user.id },
          select: { status: true, score: true, scoreReason: true, applicationId: true },
        },
      },
    });

    // Flatten the overlay onto each catalog row (defaults when no overlay exists).
    const leads = rows.map((l) => {
      const ul = l.userLeads[0];
      const { userLeads: _omit, ...rest } = l;
      void _omit;
      return {
        ...rest,
        status: ul?.status ?? "new",
        score: ul?.score ?? null,
        scoreReason: ul?.scoreReason ?? null,
        applicationId: ul?.applicationId ?? null,
      };
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
  } catch (e) {
    return apiError(e);
  }
}
