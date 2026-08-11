import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { ingestApplicationReply } from "@/lib/application-agent/replies";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const replies = await prisma.inboundReply.findMany({
      where: { applicationId: params.id, application: { userId: user.id } },
      orderBy: { receivedAt: "desc" },
    });
    return NextResponse.json({ replies });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const receivedAt = typeof body.receivedAt === "string" ? new Date(body.receivedAt) : new Date();
    const result = await ingestApplicationReply(user.id, params.id, {
      provider: typeof body.provider === "string" ? body.provider : "manual",
      providerMessageId: typeof body.providerMessageId === "string" ? body.providerMessageId : undefined,
      emailId: typeof body.emailId === "string" ? body.emailId : undefined,
      fromAddress: typeof body.fromAddress === "string" ? body.fromAddress : "",
      subject: typeof body.subject === "string" ? body.subject : "",
      body: typeof body.body === "string" ? body.body : "",
      receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
