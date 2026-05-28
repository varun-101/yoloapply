import { NextRequest, NextResponse } from "next/server";
import { extractFromText } from "@/lib/extractJob";

export const runtime = "nodejs";
export const maxDuration = 60;

// Used by the Chrome extension: sends the visible text of the current tab + URL.
// Avoids the server-side fetch (which LinkedIn/Workday block) since the user is
// already authenticated in their own browser.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text : "";
  const url = typeof body.url === "string" ? body.url : undefined;
  if (text.trim().length < 200) {
    return NextResponse.json(
      { error: "page text is too short — not enough to extract a job posting" },
      { status: 400 }
    );
  }
  try {
    const job = await extractFromText(text, url);
    return NextResponse.json(job);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
