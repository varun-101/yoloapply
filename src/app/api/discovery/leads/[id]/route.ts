import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const status = body?.status;
    if (status !== "dismissed" && status !== "new") {
      return NextResponse.json({ error: "status must be 'dismissed' or 'new'" }, { status: 400 });
    }
    const lead = await prisma.jobLead.findUnique({ where: { id: params.id } });
    if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
    const overlay = await prisma.userLead.findUnique({
      where: { userId_jobLeadId: { userId: user.id, jobLeadId: lead.id } },
    });
    if (overlay?.status === "promoted") {
      return NextResponse.json({ error: "lead is already promoted" }, { status: 400 });
    }
    // Dismiss/un-dismiss is per-user — it only affects this user's overlay.
    const updated = await prisma.userLead.upsert({
      where: { userId_jobLeadId: { userId: user.id, jobLeadId: lead.id } },
      create: { userId: user.id, jobLeadId: lead.id, status },
      update: { status },
    });
    return NextResponse.json(updated);
  } catch (e) {
    return apiError(e);
  }
}
