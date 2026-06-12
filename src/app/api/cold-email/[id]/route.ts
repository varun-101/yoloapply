import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const email = await prisma.email.findFirst({ where: { id: params.id, userId: user.id } });
    if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ email });
  } catch (e) {
    return apiError(e);
  }
}
