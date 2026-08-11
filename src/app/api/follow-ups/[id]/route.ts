import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiUserError, requireUser, apiError } from "@/lib/auth";
import {
  asFollowUpUpdate,
  cancelPendingFollowUpsForApplication,
  sendScheduledFollowUp,
} from "@/lib/application-agent/follow-up";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const result = await sendScheduledFollowUp(user.id, params.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const followUp = await prisma.followUp.findFirst({
      where: { id: params.id, application: { userId: user.id } },
      select: { id: true, applicationId: true, status: true },
    });
    if (!followUp) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (followUp.status === "SENT") throw new ApiUserError("A sent follow-up cannot be edited.", 409);

    if (body.action === "cancel") {
      await cancelPendingFollowUpsForApplication(followUp.applicationId, "Cancelled by candidate.");
      return NextResponse.json({ ok: true, status: "CANCELLED" });
    }

    const data = asFollowUpUpdate(body);
    const updated = await prisma.followUp.update({
      where: { id: followUp.id },
      data: {
        ...data,
        status: "SCHEDULED",
        errorMessage: null,
        cancelledAt: null,
        cancelReason: null,
      },
    });
    return NextResponse.json({ ok: true, followUp: updated });
  } catch (error) {
    return apiError(error);
  }
}
