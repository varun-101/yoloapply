import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { refreshDueFollowUps } from "@/lib/application-agent/follow-up";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await refreshDueFollowUps(user.id);
    const followUps = await prisma.followUp.findMany({
      where: { application: { userId: user.id } },
      include: {
        application: { select: { company: true, role: true, status: true } },
        originalEmail: { select: { toAddress: true, toName: true, subject: true, sentAt: true } },
      },
      orderBy: [{ status: "asc" }, { scheduledFor: "asc" }],
    });
    return NextResponse.json({ followUps });
  } catch (error) {
    return apiError(error);
  }
}
