import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getApplicationWorkflow } from "@/lib/application-agent/workflow";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const application = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, analysis: true },
    });
    if (!application) return NextResponse.json({ error: "not found" }, { status: 404 });
    const workflow = await getApplicationWorkflow(application.id);
    return NextResponse.json({ ...workflow, analysis: application.analysis });
  } catch (error) {
    return apiError(error);
  }
}
