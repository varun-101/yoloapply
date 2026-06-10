import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sourceTier } from "@/lib/discovery/types";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "new";
  const source = sp.get("source");
  const jobType = sp.get("jobType");
  const days = Number(sp.get("days") ?? 0);

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
    orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  // Trusted sources first, newest within each tier. Tier lives in code (config),
  // so the final sort happens here rather than in SQL.
  leads.sort((a, b) => {
    const t = sourceTier(a.source) - sourceTier(b.source);
    if (t !== 0) return t;
    const ad = a.postedAt?.getTime() ?? a.createdAt.getTime();
    const bd = b.postedAt?.getTime() ?? b.createdAt.getTime();
    return bd - ad;
  });

  return NextResponse.json(leads);
}
