import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import {
  getGenericResumeInfo,
  saveGenericResume,
  deleteGenericResume,
} from "@/lib/files";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    return NextResponse.json(await getGenericResumeInfo(user.id));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "send a file field" }, { status: 400 });
    }
    const f = file as File;
    if (f.type && f.type !== "application/pdf") {
      return NextResponse.json({ error: "must be a PDF" }, { status: 400 });
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const info = await saveGenericResume(user.id, buf, f.name || "resume.pdf");
    return NextResponse.json(info);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser(req);
    await deleteGenericResume(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
