import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractFromUrl } from "@/lib/extractJob";
import { requireUser, apiError } from "@/lib/auth";
import { getLlmConfig } from "@/lib/credentials";
import { fetchInstahyrePosting, instahyreJobIdFromUrl } from "@/lib/discovery/instahyre";

export const maxDuration = 120;

// Fetches the lead's posting URL and extracts the job description with the same
// machinery as the "New Application" URL flow. Sheet leads ship without a JD, so
// this is what unlocks Promote + Personalize for them.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    // Enriching the JD updates the SHARED catalog row — it benefits everyone.
    const lead = await prisma.jobLead.findUnique({ where: { id: params.id } });
    if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!lead.url) {
      return NextResponse.json({ error: "this lead has no posting URL to fetch" }, { status: 400 });
    }

    // Instahyre serves the whole posting as structured JSON, so this needs no
    // scrape, no LLM and no DeepSeek key — and it backfills the recruiter for
    // leads the sweep's per-tick detail cap skipped.
    const instahyreJobId = instahyreJobIdFromUrl(lead.url);
    if (instahyreJobId) {
      let posting;
      try {
        posting = await fetchInstahyrePosting(instahyreJobId);
      } catch (e: unknown) {
        // The board is unreachable, not the posting gone. Retrying is worthwhile.
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
      if (!posting || posting.jdText.trim().length < 50) {
        return NextResponse.json(
          {
            error: posting
              ? "Instahyre returned this posting without a job description."
              : "This Instahyre posting is no longer listed. It was probably filled or withdrawn.",
          },
          { status: 422 }
        );
      }
      const updated = await prisma.jobLead.update({
        where: { id: lead.id },
        data: {
          jdText: posting.jdText,
          location: lead.location ?? posting.location ?? null,
          experience: lead.experience ?? posting.experience ?? null,
          skills: lead.skills ?? posting.skills ?? null,
          jobType: lead.jobType ?? posting.jobType ?? null,
          recruiterName: lead.recruiterName ?? posting.recruiterName ?? null,
          recruiterTitle: lead.recruiterTitle ?? posting.recruiterTitle ?? null,
          recruiterCompany: lead.recruiterCompany ?? posting.recruiterCompany ?? null,
        },
      });
      return NextResponse.json(updated);
    }

    const llmCfg = await getLlmConfig(user.id);
    try {
      const job = await extractFromUrl(llmCfg, lead.url);
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
  } catch (e) {
    return apiError(e);
  }
}
