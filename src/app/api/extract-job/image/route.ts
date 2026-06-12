import { NextRequest, NextResponse } from "next/server";
import { extractFromImage } from "@/lib/extractJob";
import { requireUser, apiError } from "@/lib/auth";
import { getLlmConfig } from "@/lib/credentials";

export const maxDuration = 120;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let user;
  let llmCfg: Awaited<ReturnType<typeof getLlmConfig>>;
  try {
    user = await requireUser(req);
    llmCfg = await getLlmConfig(user.id);
  } catch (e) {
    return apiError(e);
  }

  let buf: Buffer;
  let mimeType = "image/png";
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "send a file field" }, { status: 400 });
    }
    const f = file as File;
    if (f.type && f.type.startsWith("image/")) mimeType = f.type;
    const ab = await f.arrayBuffer();
    buf = Buffer.from(ab);
    if (buf.length > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "image is larger than 12 MB" }, { status: 413 });
    }
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "couldn't read uploaded file: " + (e instanceof Error ? e.message : String(e)) },
      { status: 400 }
    );
  }

  try {
    const job = await extractFromImage(llmCfg, buf, mimeType);
    return NextResponse.json(job);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
