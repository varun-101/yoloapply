import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { startEnrich, getEnrichStatusByDomain } from "@/lib/contacts/pipeline";
import { resolveCompanyDomain } from "@/lib/contacts/domain";
import {
  failApplicationTask,
  initializeApplicationWorkflow,
  markApplicationTaskNeedsReview,
  startApplicationTask,
} from "@/lib/application-agent/workflow";
import type { EnrichStatus, LeadRecruiter } from "@/lib/contacts/pipeline";

// The recruiter the job listing itself named, straight off the promoted lead.
// Surfaced independently of enrichment: we know this person without resolving a
// domain or calling a provider, so the UI must be able to show them even when
// the search fails, hasn't run, or found nobody.
async function loadListingRecruiter(userId: string, applicationId: string): Promise<LeadRecruiter | null> {
  const userLead = await prisma.userLead.findFirst({
    where: { userId, applicationId },
    select: { jobLead: { select: { recruiterName: true, recruiterTitle: true, recruiterCompany: true } } },
  });
  const lead = userLead?.jobLead;
  if (!lead?.recruiterName) return null;
  return { name: lead.recruiterName, title: lead.recruiterTitle, company: lead.recruiterCompany };
}

async function syncRecruiterTask(applicationId: string, status: EnrichStatus) {
  await initializeApplicationWorkflow(applicationId);
  const current = await prisma.applicationTask.findUnique({
    where: { applicationId_key: { applicationId, key: "FIND_RECRUITER" } },
  });

  if (status.status === "running") {
    if (current?.status !== "RUNNING") await startApplicationTask(applicationId, "FIND_RECRUITER");
    return;
  }
  const people = status.contacts.filter((contact) => contact.source !== "role_inbox" && !!contact.name);
  if (status.status === "completed" && people.length > 0) {
    if (current?.status !== "NEEDS_REVIEW" && current?.status !== "SUCCESS") {
      await markApplicationTaskNeedsReview(
        applicationId,
        "FIND_RECRUITER",
        `${people.length} recruiter candidate${people.length === 1 ? "" : "s"} found; select one to continue.`,
        { metadata: { domain: status.domain, candidateCount: people.length, searchLocation: status.searchLocation } }
      );
    }
    return;
  }
  if (status.status === "completed" && people.length === 0) {
    if (current?.status !== "FAILED") {
      const blockedProvider = Object.values(status.sourceStats).find((source) => source.status === "quota_exhausted");
      await failApplicationTask(applicationId, "FIND_RECRUITER", blockedProvider
        ? `No recruiter people were found. A configured provider is out of credits or daily quota.`
        : `No recruiter people were found for ${status.domain}.`, {
        code: "no_recruiter_found",
        metadata: { domain: status.domain },
      });
    }
    return;
  }
  if (status.status === "failed" || status.status === "no_domain") {
    if (current?.status !== "FAILED") {
      await failApplicationTask(applicationId, "FIND_RECRUITER", status.error ?? "Recruiter discovery failed.", {
        code: status.status,
        metadata: status.domain ? { domain: status.domain } : undefined,
      });
    }
  }
}

// "Find contacts" for cold email. POST kicks off (or joins) enrichment for the
// company behind an application and returns the current status + any contacts;
// the client then polls GET ?domain=… until status is completed/failed. The run
// itself is owned by the backend (src/lib/contacts/pipeline.ts) and survives the
// client disconnecting.

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    // An empty body is allowed (defaults to {}); a non-empty but malformed body
    // is a client bug we surface explicitly rather than masking as "company
    // required". Read raw text so we can tell the two apart.
    const raw = await req.text();
    let body: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
      }
    }
    const { applicationId, company: companyIn, domain: domainIn, force } = body as {
      applicationId?: string;
      company?: string;
      domain?: string;
      force?: boolean;
    };

    let company: string = companyIn ?? "";
    let searchLocation: string | null = null;
    const urls: (string | null | undefined)[] = [];
    const fallbackUrls: (string | null | undefined)[] = [];
    const leadEmails: string[] = [];
    let leadRecruiter: LeadRecruiter | null = null;

    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
        select: { id: true, company: true, applyUrl: true, jdUrl: true, location: true },
      });
      if (!app) return NextResponse.json({ error: "application not found" }, { status: 404 });
      company = app.company;
      const profile = await prisma.userProfile.findUnique({ where: { userId: user.id }, select: { recruiterLocation: true } });
      searchLocation = profile?.recruiterLocation?.trim() || app.location?.trim() || null;
      urls.push(app.applyUrl, app.jdUrl);
      // The promoted lead often carries a real company URL + a founder email
      // (HN), both stronger signals than the apply URL.
      const userLead = await prisma.userLead.findFirst({
        where: { userId: user.id, applicationId: app.id },
        select: {
          jobLead: {
            select: {
              url: true,
              contactEmail: true,
              companyUrl: true,
              recruiterName: true,
              recruiterTitle: true,
              recruiterCompany: true,
            },
          },
        },
      });
      if (userLead?.jobLead) {
        const lead = userLead.jobLead;
        urls.unshift(lead.url);
        // A board listing's URL is the board's; the employer site the source
        // reported is the only company URL we have for it.
        fallbackUrls.push(lead.companyUrl);
        if (lead.contactEmail) leadEmails.push(lead.contactEmail);
        if (lead.recruiterName) {
          leadRecruiter = {
            name: lead.recruiterName,
            title: lead.recruiterTitle,
            company: lead.recruiterCompany,
          };
        }
      }
    }

    if (!company && !domainIn) {
      return NextResponse.json({ error: "company or domain required" }, { status: 400 });
    }

    const status = await startEnrich({
      userId: user.id,
      company,
      urls,
      fallbackUrls,
      domain: domainIn ?? undefined,
      leadEmails,
      leadRecruiter,
      force: !!force,
      searchLocation,
    });
    if (applicationId) await syncRecruiterTask(applicationId, status);
    return NextResponse.json({ ...status, listingRecruiter: leadRecruiter });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const domainParam = sp.get("domain");
    const applicationId = sp.get("applicationId");
    const listingRecruiter = applicationId ? await loadListingRecruiter(user.id, applicationId) : null;

    // Fast path: poll by an already-resolved domain (no network resolution).
    if (domainParam) {
      let searchLocation: string | null = sp.get("searchLocation")?.trim() || null;
      if (applicationId) {
        const application = await prisma.application.findFirst({
          where: { id: applicationId, userId: user.id },
          select: { id: true, location: true },
        });
        if (!application) return NextResponse.json({ error: "application not found" }, { status: 404 });
        const profile = await prisma.userProfile.findUnique({ where: { userId: user.id }, select: { recruiterLocation: true } });
        searchLocation = profile?.recruiterLocation?.trim() || application.location?.trim() || null;
      }
      const status = await getEnrichStatusByDomain(domainParam, user.id, searchLocation);
      if (status && applicationId) {
        await syncRecruiterTask(applicationId, status);
      }
      return NextResponse.json({
        ...(status ?? { domain: domainParam, status: "idle", company: "", pattern: null, error: null, enrichedAt: null, contacts: [], searchLocation, sourceStats: {} }),
        listingRecruiter,
      });
    }

    // Mount/reload path: resolve the application's domain WITHOUT kicking a run,
    // so the UI can restore an in-flight or completed result.
    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
        select: { company: true, applyUrl: true, jdUrl: true, location: true },
      });
      if (!app) return NextResponse.json({ error: "application not found" }, { status: 404 });
      const userLead = await prisma.userLead.findFirst({
        where: { userId: user.id, applicationId },
        select: { jobLead: { select: { url: true, companyUrl: true } } },
      });
      // Must mirror POST's resolution exactly — a different domain here would
      // poll a different cache row than the run writes to.
      const { domain } = await resolveCompanyDomain({
        company: app.company,
        urls: [userLead?.jobLead?.url, app.applyUrl, app.jdUrl],
        fallbackUrls: [userLead?.jobLead?.companyUrl],
      });
      const profile = await prisma.userProfile.findUnique({ where: { userId: user.id }, select: { recruiterLocation: true } });
      const searchLocation = profile?.recruiterLocation?.trim() || app.location?.trim() || null;
      if (!domain) {
        return NextResponse.json({ domain: null, status: "no_domain", company: app.company, pattern: null, error: null, enrichedAt: null, contacts: [], searchLocation, sourceStats: {}, listingRecruiter });
      }
      const status = await getEnrichStatusByDomain(domain, user.id, searchLocation);
      if (status) await syncRecruiterTask(applicationId, status);
      return NextResponse.json({
        ...(status ?? { domain, status: "idle", company: app.company, pattern: null, error: null, enrichedAt: null, contacts: [], searchLocation, sourceStats: {} }),
        listingRecruiter,
      });
    }

    return NextResponse.json({ error: "domain or applicationId required" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
