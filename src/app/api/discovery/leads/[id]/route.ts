import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const status = body?.status;
  if (status !== "dismissed" && status !== "new") {
    return NextResponse.json({ error: "status must be 'dismissed' or 'new'" }, { status: 400 });
  }
  const lead = await prisma.jobLead.findUnique({ where: { id: params.id } });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (lead.status === "promoted") {
    return NextResponse.json({ error: "lead is already promoted" }, { status: 400 });
  }
  const updated = await prisma.jobLead.update({ where: { id: params.id }, data: { status } });
  return NextResponse.json(updated);
}
