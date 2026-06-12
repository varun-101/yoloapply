import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { getFileMeta, readGenericResume } from "@/lib/files";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const buf = await readGenericResume(user.id);
    if (!buf) return NextResponse.json({ error: "no generic resume uploaded" }, { status: 404 });
    const meta = await getFileMeta(user.id, null, "generic_resume");
    const inline = new URL(req.url).searchParams.get("download") !== "1";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${meta?.filename ?? "resume.pdf"}"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
