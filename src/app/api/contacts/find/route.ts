import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { startEnrich, getEnrichStatusByDomain } from "@/lib/contacts/pipeline";
import { resolveCompanyDomain } from "@/lib/contacts/domain";

// "Find contacts" for cold email. POST kicks off (or joins) enrichment for the
// company behind an application and returns the current status + any contacts;
// the client then polls GET ?domain=… until status is completed/failed. The run
// itself is owned by the backend (src/lib/contacts/pipeline.ts) and survives the
// client disconnecting.

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { applicationId, company: companyIn, domain: domainIn, force } = body ?? {};

    let company: string = companyIn ?? "";
    const urls: (string | null | undefined)[] = [];
    const leadEmails: string[] = [];

    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
        select: { id: true, company: true, applyUrl: true, jdUrl: true },
      });
      if (!app) return NextResponse.json({ error: "application not found" }, { status: 404 });
      company = app.company;
      urls.push(app.applyUrl, app.jdUrl);
      // The promoted lead often carries a real company URL + a founder email
      // (HN), both stronger signals than the apply URL.
      const userLead = await prisma.userLead.findFirst({
        where: { userId: user.id, applicationId: app.id },
        select: { jobLead: { select: { url: true, contactEmail: true } } },
      });
      if (userLead?.jobLead) {
        urls.unshift(userLead.jobLead.url);
        if (userLead.jobLead.contactEmail) leadEmails.push(userLead.jobLead.contactEmail);
      }
    }

    if (!company && !domainIn) {
      return NextResponse.json({ error: "company or domain required" }, { status: 400 });
    }

    const status = await startEnrich({
      userId: user.id,
      company,
      urls,
      domain: domainIn ?? undefined,
      leadEmails,
      force: !!force,
    });
    return NextResponse.json(status);
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

    // Fast path: poll by an already-resolved domain (no network resolution).
    if (domainParam) {
      const status = await getEnrichStatusByDomain(domainParam);
      return NextResponse.json(
        status ?? { domain: domainParam, status: "idle", company: "", pattern: null, error: null, enrichedAt: null, contacts: [] }
      );
    }

    // Mount/reload path: resolve the application's domain WITHOUT kicking a run,
    // so the UI can restore an in-flight or completed result.
    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
        select: { company: true, applyUrl: true, jdUrl: true },
      });
      if (!app) return NextResponse.json({ error: "application not found" }, { status: 404 });
      const userLead = await prisma.userLead.findFirst({
        where: { userId: user.id, applicationId },
        select: { jobLead: { select: { url: true } } },
      });
      const { domain } = await resolveCompanyDomain({
        company: app.company,
        urls: [userLead?.jobLead?.url, app.applyUrl, app.jdUrl],
      });
      if (!domain) {
        return NextResponse.json({ domain: null, status: "no_domain", company: app.company, pattern: null, error: null, enrichedAt: null, contacts: [] });
      }
      const status = await getEnrichStatusByDomain(domain);
      return NextResponse.json(
        status ?? { domain, status: "idle", company: app.company, pattern: null, error: null, enrichedAt: null, contacts: [] }
      );
    }

    return NextResponse.json({ error: "domain or applicationId required" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
