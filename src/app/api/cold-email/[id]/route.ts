import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const email = await prisma.email.findUnique({ where: { id: params.id } });
  if (!email) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ email });
}
