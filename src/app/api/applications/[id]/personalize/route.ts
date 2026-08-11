import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { personalizeOnePage } from "@/lib/onePage";
import { saveResumeArtifacts } from "@/lib/compile";
import { requireUser, apiError } from "@/lib/auth";
import { getProfile, resumeFilename } from "@/lib/profile";
import {
  completeApplicationTask,
  failApplicationTask,
  startApplicationTask,
} from "@/lib/application-agent/workflow";

export const maxDuration = 300;

// Consider a "running" marker stale after this long (covers a server crash
// mid-run that would otherwise leave the app stuck in a loading state).
const STALE_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!app.jdText || app.jdText.trim().length < 50) {
      return NextResponse.json(
        { error: "Add a job description (at least a paragraph) before personalizing." },
        { status: 400 }
      );
    }

    // If a personalize is already running and isn't stale, don't start a second one.
    if (app.personalizeStatus === "running" && Date.now() - app.updatedAt.getTime() < STALE_MS) {
      return NextResponse.json({ ok: true, status: "running", alreadyRunning: true });
    }

    const workflowTask = await startApplicationTask(app.id, "GENERATE_RESUME", STALE_MS);
    if (workflowTask.alreadyRunning) {
      return NextResponse.json({ ok: true, status: "running", alreadyRunning: true });
    }

    // Mark running BEFORE the long await, in its own committed write, so a page
    // refresh (or any concurrent GET) sees the in-progress state. Node runs this
    // handler to completion even if the original client navigates away, so the DB
    // is updated regardless — the refreshed page polls and picks up the result.
    await prisma.application.update({
      where: { id: app.id },
      data: { personalizeStatus: "running" },
    });

    try {
      const result = await personalizeOnePage(user.id, {
        company: app.company,
        role: app.role,
        jobDescription: app.jdText,
      });
      const profile = await getProfile(user.id);
      await saveResumeArtifacts(
        user.id,
        app.id,
        result.tex,
        result.pdf,
        resumeFilename(profile, "Resume", app.company)
      );
      const updated = await prisma.application.update({
        where: { id: app.id },
        data: { status: "personalized", personalizeStatus: null },
      });
      const detail = result.clippedFromMultiPage
        ? `Re-personalized at tightness ${result.tightness} — overflowed to ${result.pages} pages, clipped to first page.`
        : `Re-personalized at tightness ${result.tightness} (${result.attempts} pass${result.attempts === 1 ? "" : "es"}, fits one page).`;
      await prisma.event.create({
        data: { applicationId: app.id, type: "personalized", detail },
      });
      await completeApplicationTask(app.id, "GENERATE_RESUME", {
        metadata: {
          tightness: result.tightness,
          attempts: result.attempts,
          pages: result.pages,
          clippedFromMultiPage: result.clippedFromMultiPage,
        },
      });
      return NextResponse.json({ ok: true, application: updated });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await failApplicationTask(app.id, "GENERATE_RESUME", e);
      await prisma.application.update({
        where: { id: app.id },
        data: { personalizeStatus: "failed" },
      });
      await prisma.event.create({
        data: { applicationId: app.id, type: "note", detail: "Personalization failed: " + msg.slice(0, 500) },
      });
      return apiError(e);
    }
  } catch (e) {
    return apiError(e);
  }
}
