import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const take = Math.min(Number(req.nextUrl.searchParams.get("take") ?? 50) || 50, 200);
    const scans = await prisma.scanRun.findMany({
      where: { userId: user.id, trigger: { not: "score" } },
      orderBy: { startedAt: "desc" },
      take,
      include: { _count: { select: { leads: true } } },
    });
    return NextResponse.json(scans);
  } catch (e) {
    return apiError(e);
  }
}
