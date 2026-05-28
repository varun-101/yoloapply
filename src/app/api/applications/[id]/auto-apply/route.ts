import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { spawn } from "child_process";
import path from "path";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!app.applyUrl) return NextResponse.json({ error: "applyUrl not set on application" }, { status: 400 });
  if (!app.resumePdfPath) return NextResponse.json({ error: "personalize the resume first" }, { status: 400 });

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
}
