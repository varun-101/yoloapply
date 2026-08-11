import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { resolveCompanyDomain, registrableDomain } from "@/lib/contacts/domain";
import { recruiterRelevanceRank, compositeRank } from "@/lib/contacts/rank";
import { isPlausibleEmail } from "@/lib/contacts/verify";

function keyFor(userId: string, domain: string, location: string | null) {
  return createHash("sha256").update(`${userId}|${domain}|${location?.toLowerCase() ?? "global"}`).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const linkedinUrl = typeof body.linkedinUrl === "string" ? body.linkedinUrl.trim() : "";
    const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!applicationId || (!name && !linkedinUrl && !rawEmail)) {
      return NextResponse.json({ error: "applicationId and a name, LinkedIn URL, or email are required" }, { status: 400 });
    }
    if (linkedinUrl && !/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i.test(linkedinUrl)) {
      return NextResponse.json({ error: "Enter a LinkedIn profile URL (linkedin.com/in/...)." }, { status: 400 });
    }
    if (rawEmail && !isPlausibleEmail(rawEmail)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const app = await prisma.application.findFirst({
      where: { id: applicationId, userId: user.id },
      select: { company: true, location: true, applyUrl: true, jdUrl: true },
    });
    if (!app) return NextResponse.json({ error: "application not found" }, { status: 404 });
    const profile = await prisma.userProfile.findUnique({ where: { userId: user.id }, select: { recruiterLocation: true } });
    const searchLocation = profile?.recruiterLocation?.trim() || app.location?.trim() || null;
    const resolved = await resolveCompanyDomain({ company: app.company, urls: [app.applyUrl, app.jdUrl] });
    if (!resolved.domain) return NextResponse.json({ error: "Could not determine the company domain." }, { status: 400 });
    const domain = registrableDomain(resolved.domain);
    const intentKey = keyFor(user.id, domain, searchLocation);
    const cache = await prisma.companyContactCache.upsert({
      where: { intentKey },
      create: {
        intentKey,
        ownerUserId: user.id,
        domain,
        company: app.company,
        searchLocation,
        status: "completed",
        sourceStats: JSON.stringify({ manual: { found: 1, status: "ok" } }),
      },
      update: {},
    });
    const relevance = recruiterRelevanceRank(title, location, searchLocation);
    const confidence = rawEmail ? 0.75 : 0;
    const existing = linkedinUrl
      ? await prisma.discoveredContact.findFirst({ where: { cacheId: cache.id, linkedinUrl } })
      : rawEmail
        ? await prisma.discoveredContact.findFirst({ where: { cacheId: cache.id, email: rawEmail } })
        : null;
    const data = {
      name: name || null,
      title: title || null,
      location: location || searchLocation,
      linkedinUrl: linkedinUrl || null,
      email: rawEmail || null,
      source: "manual",
      confidence,
      verified: false,
      contactStatus: rawEmail ? "resolved" : "not_requested",
      seniorityRank: relevance,
      rank: compositeRank({ email: rawEmail || null, confidence, verified: false, seniorityRank: relevance }),
    };
    const candidate = existing
      ? await prisma.discoveredContact.update({ where: { id: existing.id }, data })
      : await prisma.discoveredContact.create({ data: { cacheId: cache.id, ...data } });
    return NextResponse.json({ candidate });
  } catch (error) {
    return apiError(error);
  }
}
