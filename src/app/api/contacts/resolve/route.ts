import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { getApolloKey, getSignalHireKey } from "@/lib/credentials";
import { resolveApolloContact } from "@/lib/contacts/lanes/apollo";
import { resolveSignalHireContact } from "@/lib/contacts/lanes/signalhire";
import { compositeRank, recruiterRelevanceRank } from "@/lib/contacts/rank";
import { completeApplicationTask } from "@/lib/application-agent/workflow";
import type { RawCandidate } from "@/lib/contacts/types";

async function materializeContact(userId: string, applicationId: string, company: string, candidate: {
  name: string | null; title: string | null; email: string; phone: string | null; linkedinUrl: string | null;
  source: string; cache: { domain: string };
}) {
  const existing = await prisma.contact.findFirst({ where: { userId, email: candidate.email } });
  const contact = existing
    ? await prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: candidate.name || existing.name,
          title: candidate.title || existing.title,
          company,
          phone: candidate.phone || existing.phone,
          linkedinUrl: candidate.linkedinUrl || existing.linkedinUrl,
          applicationId,
          domain: candidate.cache.domain,
        },
      })
    : await prisma.contact.create({
        data: {
          userId,
          applicationId,
          name: candidate.name || candidate.email,
          title: candidate.title,
          company,
          email: candidate.email,
          phone: candidate.phone,
          linkedinUrl: candidate.linkedinUrl,
          source: candidate.source === "manual" ? "manual" : "discovered",
          domain: candidate.cache.domain,
        },
      });
  await completeApplicationTask(applicationId, "FIND_RECRUITER", {
    metadata: { contactId: contact.id, email: candidate.email, name: candidate.name },
  });
  return contact;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
    const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
    const app = await prisma.application.findFirst({ where: { id: applicationId, userId: user.id }, select: { id: true, company: true } });
    if (!app) return NextResponse.json({ error: "application not found" }, { status: 404 });
    let candidate = await prisma.discoveredContact.findFirst({
      where: { id: candidateId, cache: { ownerUserId: user.id } },
      include: { cache: true },
    });
    if (!candidate) return NextResponse.json({ error: "recruiter candidate not found" }, { status: 404 });

    if (!candidate.email) {
      const claim = await prisma.discoveredContact.updateMany({
        where: { id: candidate.id, email: null, contactStatus: { in: ["not_requested", "failed"] } },
        data: { contactStatus: "resolving" },
      });
      if (claim.count === 0) {
        return NextResponse.json({ error: "This contact is already being resolved. Refresh in a moment." }, { status: 409 });
      }
      try {
        const [signalhireKey, apolloKey] = await Promise.all([getSignalHireKey(user.id), getApolloKey(user.id)]);
        let resolved: RawCandidate;
        if (candidate.source === "signalhire") {
          if (!signalhireKey) throw new Error("Add a SignalHire API key in Settings → Credentials.");
          resolved = await resolveSignalHireContact(signalhireKey, candidate);
        } else if (candidate.source === "apollo") {
          if (!apolloKey) throw new Error("Add an Apollo API key in Settings → Credentials.");
          resolved = await resolveApolloContact(apolloKey, { ...candidate, domain: candidate.cache.domain });
        } else if (candidate.linkedinUrl && signalhireKey) {
          // A LinkedIn URL identifies this exact person, so it stays valid even
          // for someone who doesn't work at the employer.
          resolved = await resolveSignalHireContact(signalhireKey, candidate);
        } else if (candidate.skipResolve) {
          // Looking this person up by name against the EMPLOYER's domain would
          // return whoever works there under the same name, and we'd store that
          // stranger's address as the recruiter for this application.
          throw new Error(
            `${candidate.name ?? "This recruiter"} is hiring for this role from outside the company, so their email can't be looked up against the employer's domain. Open their LinkedIn profile to reach them, or add their address with "Add person".`
          );
        } else if (apolloKey) {
          resolved = await resolveApolloContact(apolloKey, { ...candidate, domain: candidate.cache.domain });
        } else {
          throw new Error("Add SignalHire or Apollo credentials to reveal this person's email.");
        }
        const relevance = recruiterRelevanceRank(
          resolved.title ?? candidate.title,
          resolved.location ?? candidate.location,
          candidate.cache.searchLocation
        );
        candidate = await prisma.discoveredContact.update({
          where: { id: candidate.id },
          data: {
            name: resolved.name ?? candidate.name,
            title: resolved.title ?? candidate.title,
            email: resolved.email ?? null,
            phone: resolved.phone ?? candidate.phone,
            linkedinUrl: resolved.linkedinUrl ?? candidate.linkedinUrl,
            location: resolved.location ?? candidate.location,
            providerPersonId: resolved.providerPersonId ?? candidate.providerPersonId,
            source: resolved.source,
            sources: candidate.source === resolved.source ? candidate.sources : `${candidate.source},${resolved.source}`,
            confidence: resolved.confidence,
            verified: !!resolved.verified,
            verifyMethod: resolved.verifyMethod ?? null,
            seniorityRank: relevance,
            rank: compositeRank({ email: resolved.email ?? null, confidence: resolved.confidence, verified: !!resolved.verified, seniorityRank: relevance }),
            contactStatus: resolved.email ? "resolved" : "failed",
          },
          include: { cache: true },
        });
        if (!candidate.email) {
          return NextResponse.json(
            {
              error: candidate.linkedinUrl
                ? "SignalHire returned the person's LinkedIn profile but did not return an email address."
                : "The provider found this person but did not return an email address.",
              candidate,
            },
            { status: 422 }
          );
        }
      } catch (error) {
        await prisma.discoveredContact.update({ where: { id: candidate.id }, data: { contactStatus: "failed" } }).catch(() => {});
        throw error;
      }
    }

    const contact = await materializeContact(user.id, app.id, app.company, candidate as typeof candidate & { email: string });
    return NextResponse.json({ candidate, contact });
  } catch (error) {
    return apiError(error);
  }
}
