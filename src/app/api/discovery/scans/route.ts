import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const take = Math.min(Number(req.nextUrl.searchParams.get("take") ?? 50) || 50, 200);
  const scans = await prisma.scanRun.findMany({
    orderBy: { startedAt: "desc" },
    take,
    include: { _count: { select: { leads: true } } },
  });
  return NextResponse.json(scans);
}
