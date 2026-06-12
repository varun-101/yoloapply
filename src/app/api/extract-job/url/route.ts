import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl } from "@/lib/extractJob";
import { requireUser, apiError } from "@/lib/auth";
import { getLlmConfig } from "@/lib/credentials";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const llmCfg = await getLlmConfig(user.id);
    const body = await req.json().catch(() => ({}));
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
    try {
      const job = await extractFromUrl(llmCfg, url);
      return NextResponse.json(job);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  } catch (e) {
    return apiError(e);
  }
}
