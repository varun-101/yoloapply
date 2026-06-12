import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn } from "child_process";
import path from "path";
import { requireUser, apiError } from "@/lib/auth";
import { fileExists } from "@/lib/files";

// Local-only legacy flow: spawns a headed Playwright worker on the machine
// running the server. On a deployed instance the Chrome extension is the
// supported prefill path.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!app.applyUrl) return NextResponse.json({ error: "applyUrl not set on application" }, { status: 400 });
    if (!(await fileExists(user.id, app.id, "resume_pdf"))) {
      return NextResponse.json({ error: "personalize the resume first" }, { status: 400 });
    }

    const cwd = path.resolve(".");
    const script = path.join(cwd, "scripts", "auto-apply.ts");

    // Spawn a detached worker. The worker runs Playwright headed; the user
    // watches and clicks submit. Output is not piped here — they get the browser.
    const child = spawn(process.execPath, [
      "--experimental-strip-types",
      "--no-warnings",
      script,
      "--id",
      app.id,
    ], {
      cwd,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();

    await prisma.event.create({
      data: { applicationId: app.id, type: "note", detail: `Auto-apply worker launched (pid ${child.pid}).` },
    });

    return NextResponse.json({ ok: true, pid: child.pid });
  } catch (e) {
    return apiError(e);
  }
}
