import { prisma } from "../db";
import { ApiUserError } from "../auth";
import { describeFit, fitMetadata, personalizeOnePage } from "../onePage";
import { saveResumeArtifacts } from "../compile";
import { getProfile, resumeFilename } from "../profile";
import { getLlmConfig } from "../credentials";
import { completeApplicationTask, failApplicationTask, startApplicationTask } from "./workflow";

// Tailored-resume generation for one application. The durable state is the
// GENERATE_RESUME ApplicationTask plus Application.personalizeStatus, so the
// dashboard and MCP agents see the same running/failed/completed state and a
// duplicate kick joins the run in flight instead of starting a second one.

// A "running" marker older than this is treated as a crashed run.
export const RESUME_STALE_MS = 5 * 60 * 1000;

type Owned = { id: string; company: string; role: string; jdText: string | null; personalizeStatus: string | null; updatedAt: Date };

async function ownedApplication(userId: string, applicationId: string): Promise<Owned> {
  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: { id: true, company: true, role: true, jdText: true, personalizeStatus: true, updatedAt: true },
  });
  if (!app) throw new ApiUserError("Application not found.", 404, "not_found");
  if (!app.jdText || app.jdText.trim().length < 50) {
    throw new ApiUserError("Add a job description (at least a paragraph) before personalizing.", 400, "no_job_description");
  }
  return app;
}

function isRunning(app: Owned) {
  return app.personalizeStatus === "running" && Date.now() - app.updatedAt.getTime() < RESUME_STALE_MS;
}

async function claim(app: Owned): Promise<boolean> {
  if (isRunning(app)) return false;
  const task = await startApplicationTask(app.id, "GENERATE_RESUME", RESUME_STALE_MS);
  if (task.alreadyRunning) return false;
  // Committed before the long await so any concurrent reader sees "running".
  await prisma.application.update({ where: { id: app.id }, data: { personalizeStatus: "running" } });
  return true;
}

// Typical wall time of one generation: one LLM tailoring call, then 4-6
// compiles while the layout is fitted to one page.
export const RESUME_TYPICAL_SECONDS = { min: 30, max: 75 };

async function generate(userId: string, app: Owned) {
  try {
    const result = await personalizeOnePage(
      userId,
      { company: app.company, role: app.role, jobDescription: app.jdText! },
      (p) => {
        // Best-effort progress for get_resume_status; never fails the run.
        prisma.applicationTask
          .updateMany({
            where: { applicationId: app.id, key: "GENERATE_RESUME" },
            data: { metadata: { progress: { ...p, at: new Date().toISOString() } } },
          })
          .catch(() => {});
      }
    );
    const profile = await getProfile(userId);
    await saveResumeArtifacts(userId, app.id, result.tex, result.pdf, resumeFilename(profile, "Resume", app.company));
    const updated = await prisma.application.update({
      where: { id: app.id },
      data: { status: "personalized", personalizeStatus: null },
    });
    await prisma.event.create({
      data: { applicationId: app.id, type: "personalized", detail: `Re-personalized: ${describeFit(result)}.` },
    });
    await completeApplicationTask(app.id, "GENERATE_RESUME", { metadata: fitMetadata(result) });
    return updated;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await failApplicationTask(app.id, "GENERATE_RESUME", e);
    await prisma.application.update({ where: { id: app.id }, data: { personalizeStatus: "failed" } });
    await prisma.event.create({
      data: { applicationId: app.id, type: "note", detail: "Personalization failed: " + msg.slice(0, 500) },
    });
    throw e;
  }
}

/** Runs to completion in the caller (the dashboard route awaits it). */
export async function runResumeGeneration(userId: string, applicationId: string) {
  const app = await ownedApplication(userId, applicationId);
  if (!(await claim(app))) return { alreadyRunning: true as const };
  const application = await generate(userId, app);
  return { alreadyRunning: false as const, application };
}

/**
 * Starts generation in the background and returns at once. The server owns
 * the run, so the caller can disconnect and poll getResumeStatus later.
 * Preconditions (profile, LLM key, JD) are checked first so obvious failures
 * come back synchronously instead of as a failed run.
 */
export async function startResumeGeneration(userId: string, applicationId: string) {
  const app = await ownedApplication(userId, applicationId);
  await getProfile(userId);
  await getLlmConfig(userId);
  if (!(await claim(app))) return { started: false, status: "already_running" as const };
  void generate(userId, app).catch(() => {
    // Failure is persisted on the task, the application and its events.
  });
  return { started: true, status: "running" as const };
}

export async function getResumeStatus(userId: string, applicationId: string) {
  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: {
      id: true,
      personalizeStatus: true,
      updatedAt: true,
      tasks: { where: { key: "GENERATE_RESUME" }, take: 1 },
      files: {
        where: { kind: { in: ["resume_pdf", "resume_tex"] } },
        select: { kind: true, filename: true, size: true, updatedAt: true },
      },
    },
  });
  if (!app) throw new ApiUserError("Application not found.", 404, "not_found");
  const task = app.tasks[0] ?? null;
  const pdf = app.files.find((f) => f.kind === "resume_pdf") ?? null;
  const running = app.personalizeStatus === "running" && Date.now() - app.updatedAt.getTime() < RESUME_STALE_MS;
  const status = running
    ? "running"
    : app.personalizeStatus === "failed" || task?.status === "FAILED"
      ? "failed"
      : pdf
        ? "completed"
        : "idle";
  const meta = (task?.metadata ?? null) as { progress?: { stage?: string; compiles?: number } } | null;
  const elapsedMs = running && task?.startedAt ? Date.now() - task.startedAt.getTime() : null;
  return {
    applicationId: app.id,
    status,
    progress: running
      ? {
          stage: meta?.progress?.stage ?? "starting",
          compiles: meta?.progress?.compiles ?? 0,
          elapsedSeconds: elapsedMs === null ? null : Math.round(elapsedMs / 1000),
          typicalTotalSeconds: RESUME_TYPICAL_SECONDS,
          pollAfterSeconds: meta?.progress?.stage === "fitting" ? 10 : 15,
        }
      : null,
    task: task
      ? {
          status: task.status,
          attempt: task.attempt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          error: task.errorMessage,
          metadata: task.metadata,
        }
      : null,
    files: app.files,
  };
}
