import type { JobLead } from "@prisma/client";
import { prisma } from "../db";
import { ApiUserError } from "../auth";
import { extractFromUrl } from "../extractJob";
import { getLlmConfig } from "../credentials";
import { fetchInstahyrePosting, instahyreJobIdFromUrl } from "./instahyre";

// Fetches a catalog lead's posting URL and stores the extracted job
// description on the SHARED row (it benefits every user). Shared by
// POST /api/discovery/leads/[id]/fetch-jd and the MCP get_job live refresh.
export async function refreshLeadJd(userId: string, lead: JobLead): Promise<JobLead> {
  if (!lead.url) throw new ApiUserError("this lead has no posting URL to fetch", 400, "no_url");

  // Instahyre serves the whole posting as structured JSON, so this needs no
  // scrape, no LLM and no DeepSeek key, and it backfills the recruiter for
  // leads the sweep's per-tick detail cap skipped.
  const instahyreJobId = instahyreJobIdFromUrl(lead.url);
  if (instahyreJobId) {
    let posting;
    try {
      posting = await fetchInstahyrePosting(instahyreJobId);
    } catch (e: unknown) {
      // The board is unreachable, not the posting gone. Retrying is worthwhile.
      throw new ApiUserError(e instanceof Error ? e.message : String(e), 502, "source_unreachable");
    }
    if (!posting || posting.jdText.trim().length < 50) {
      throw new ApiUserError(
        posting
          ? "Instahyre returned this posting without a job description."
          : "This Instahyre posting is no longer listed. It was probably filled or withdrawn.",
        422,
        posting ? "no_description" : "posting_gone"
      );
    }
    return prisma.jobLead.update({
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
  }

  const llmCfg = await getLlmConfig(userId);
  let job;
  try {
    job = await extractFromUrl(llmCfg, lead.url);
  } catch (e: unknown) {
    throw new ApiUserError(e instanceof Error ? e.message : String(e), 422, "extract_failed");
  }
  if (!job.jdText || job.jdText.trim().length < 50) {
    throw new ApiUserError("Fetched the page but couldn't extract a usable job description.", 422, "no_description");
  }
  // The listing's company/role are trusted; extraction only fills what's missing.
  return prisma.jobLead.update({
    where: { id: lead.id },
    data: { jdText: job.jdText, location: lead.location ?? job.location ?? null },
  });
}
