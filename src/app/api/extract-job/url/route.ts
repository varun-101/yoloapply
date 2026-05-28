import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl } from "@/lib/extractJob";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  try {
    const job = await extractFromUrl(url);
    return NextResponse.json(job);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
