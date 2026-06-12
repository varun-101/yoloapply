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
    const lead = await prisma.jobLead.findFirst({ where: { id: params.id, userId: user.id } });
    if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (lead.status === "promoted") {
      return NextResponse.json({ error: "lead is already promoted" }, { status: 400 });
    }
    const updated = await prisma.jobLead.update({ where: { id: lead.id }, data: { status } });
    return NextResponse.json(updated);
  } catch (e) {
    return apiError(e);
  }
}
