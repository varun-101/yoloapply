import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractFromUrl } from "@/lib/extractJob";

export const maxDuration = 120;

// Fetches the lead's posting URL and extracts the job description with the same
// machinery as the "New Application" URL flow. Sheet leads ship without a JD, so
// this is what unlocks Promote + Personalize for them.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const lead = await prisma.jobLead.findUnique({ where: { id: params.id } });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!lead.url) {
    return NextResponse.json({ error: "this lead has no posting URL to fetch" }, { status: 400 });
  }

  try {
    const job = await extractFromUrl(lead.url);
    if (!job.jdText || job.jdText.trim().length < 50) {
      return NextResponse.json(
        { error: "Fetched the page but couldn't extract a usable job description." },
        { status: 422 }
      );
    }
    // The sheet's company/role are trusted; extraction only fills what's missing.
    const updated = await prisma.jobLead.update({
      where: { id: lead.id },
      data: {
        jdText: job.jdText,
        location: lead.location ?? job.location ?? null,
      },
    });
    return NextResponse.json(updated);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
