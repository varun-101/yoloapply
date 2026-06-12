import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

// Creates an Application from a lead. Personalization is intentionally not done
// here — the client chains POST /api/applications/[id]/personalize so this
// request stays fast and the existing running/failed state machinery applies.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const lead = await prisma.jobLead.findFirst({ where: { id: params.id, userId: user.id } });
    if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (lead.status === "promoted" && lead.applicationId) {
      return NextResponse.json({ applicationId: lead.applicationId, alreadyPromoted: true });
    }

    const app = await prisma.application.create({
      data: {
        userId: user.id,
        company: lead.company,
        role: lead.role,
        source: lead.source,
        jdUrl: lead.url ?? null,
        jdText: lead.jdText ?? null,
        applyUrl: lead.url ?? null,
        location: lead.location ?? null,
        notes: [
          lead.salary ? `Salary: ${lead.salary}` : null,
          lead.experience ? `Experience: ${lead.experience}` : null,
          lead.skills ? `Skills: ${lead.skills}` : null,
        ]
          .filter(Boolean)
          .join("\n") || null,
        status: "draft",
      },
    });
    await prisma.event.create({
      data: {
        applicationId: app.id,
        type: "status_change",
        detail: `draft (promoted from ${lead.source} discovery)`,
      },
    });
    await prisma.jobLead.update({
      where: { id: lead.id },
      data: { status: "promoted", applicationId: app.id },
    });

    return NextResponse.json({ applicationId: app.id });
  } catch (e) {
    return apiError(e);
  }
}
