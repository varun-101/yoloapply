import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { refreshLeadJd } from "@/lib/discovery/leadJd";

export const maxDuration = 120;

// Fetches the lead's posting URL and extracts the job description with the same
// machinery as the "New Application" URL flow. Sheet leads ship without a JD, so
// this is what unlocks Promote + Personalize for them.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const lead = await prisma.jobLead.findUnique({ where: { id: params.id } });
    if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(await refreshLeadJd(user.id, lead));
  } catch (e) {
    return apiError(e);
  }
}
