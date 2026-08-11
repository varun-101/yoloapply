import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftColdEmail } from "@/lib/coldEmail";
import { requireUser, apiError } from "@/lib/auth";
import {
  completeApplicationTask,
  failApplicationTask,
  startApplicationTask,
} from "@/lib/application-agent/workflow";

export async function POST(req: NextRequest) {
  let workflowApplicationId: string | null = null;
  let workflowStarted = false;
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const { company, recipientName, recipientTitle, recipientEmail, role, hookContext, applicationId, emailId, recruiterCandidateId } =
      body ?? {};
    if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

    // When drafting for a tracked application, feed the listing into the prompt
    // so the email references the exact role, mirrors the JD, and links the posting.
    let jobContext;
    let roleFromApp: string | undefined;
    let ownedApplicationId: string | null = null;
    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
      });
      if (app) {
        ownedApplicationId = app.id;
        workflowApplicationId = app.id;
        roleFromApp = app.role;
        jobContext = {
          applyUrl: app.applyUrl ?? app.jdUrl ?? undefined,
          location: app.location ?? undefined,
          jdExcerpt: app.jdText?.slice(0, 1500),
          alreadyApplied: !!app.appliedAt || app.status === "applied",
        };
      }
    }

    if (ownedApplicationId) {
      const started = await startApplicationTask(ownedApplicationId, "GENERATE_OUTREACH");
      if (started.alreadyRunning) {
        return NextResponse.json({ error: "Outreach generation is already running." }, { status: 409 });
      }
      workflowStarted = true;
    }

    const draft = await draftColdEmail(user.id, {
      company,
      recipientName,
      recipientTitle,
      role: role || roleFromApp,
      hookContext,
      jobContext,
    });

    const cred = await prisma.userCredential.findUnique({ where: { userId: user.id } });

    // Choosing a discovered candidate currently deep-links to this draft page.
    // Materialize that choice as the existing tenant-owned Contact abstraction
    // so recruiter selection is durable without introducing a parallel model.
    let selectedContactId: string | null = null;
    const recruiterCandidate = ownedApplicationId && recipientEmail && recruiterCandidateId
      ? await prisma.discoveredContact.findFirst({
          where: {
            id: recruiterCandidateId,
            email: String(recipientEmail).trim().toLowerCase(),
            source: { not: "role_inbox" },
            cache: { ownerUserId: user.id },
          },
        })
      : null;
    if (ownedApplicationId && recipientEmail && recruiterCandidate) {
      const normalizedEmail = String(recipientEmail).trim().toLowerCase();
      const existingContact = await prisma.contact.findFirst({
        where: { userId: user.id, email: normalizedEmail },
      });
      if (existingContact) {
        const selected = await prisma.contact.update({
          where: { id: existingContact.id },
          data: {
            name: recipientName || recruiterCandidate.name || existingContact.name,
            title: recipientTitle || recruiterCandidate.title || existingContact.title,
            company: company || existingContact.company,
            phone: recruiterCandidate.phone || existingContact.phone,
            linkedinUrl: recruiterCandidate.linkedinUrl || existingContact.linkedinUrl,
            applicationId: existingContact.applicationId ?? ownedApplicationId,
          },
        });
        selectedContactId = selected.id;
      } else {
        const selected = await prisma.contact.create({
          data: {
            userId: user.id,
            name: recipientName || recruiterCandidate.name || normalizedEmail,
            title: recipientTitle || recruiterCandidate.title || null,
            company,
            email: normalizedEmail,
            phone: recruiterCandidate.phone,
            linkedinUrl: recruiterCandidate.linkedinUrl,
            source: "discovered",
            applicationId: ownedApplicationId,
          },
        });
        selectedContactId = selected.id;
      }
      await completeApplicationTask(ownedApplicationId, "FIND_RECRUITER", {
        metadata: {
          contactId: selectedContactId,
          email: normalizedEmail,
          name: recipientName || null,
        },
      });
    }

    // Persist the draft immediately so it survives even if it is never sent.
    // Regenerating with the same emailId overwrites the previous draft row.
    const data = {
      userId: user.id,
      toAddress: recipientEmail ?? "",
      toName: recipientName || null,
      fromAddress: cred?.smtpUser ?? user.email,
      subject: draft.subject,
      body: draft.body,
      status: "draft",
      applicationId: ownedApplicationId,
      contactId: selectedContactId,
      recipientTitle: recipientTitle || null,
      recipientCompany: company,
      roleTarget: role || roleFromApp || null,
      hookContext: hookContext || null,
      rationale: draft.rationale ?? null,
    };
    let saved;
    if (emailId) {
      const existing = await prisma.email.findFirst({ where: { id: emailId, userId: user.id } });
      saved =
        existing && existing.status === "draft"
          ? await prisma.email.update({ where: { id: existing.id }, data })
          : await prisma.email.create({ data });
    } else {
      saved = await prisma.email.create({ data });
    }

    if (ownedApplicationId) {
      await completeApplicationTask(ownedApplicationId, "GENERATE_OUTREACH", {
        metadata: { emailId: saved.id, contactId: selectedContactId },
      });
    }

    return NextResponse.json({ ...draft, emailId: saved.id });
  } catch (e) {
    if (workflowApplicationId && workflowStarted) {
      await failApplicationTask(workflowApplicationId, "GENERATE_OUTREACH", e).catch(() => {});
    }
    return apiError(e);
  }
}
