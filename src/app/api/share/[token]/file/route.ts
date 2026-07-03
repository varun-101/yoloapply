import { NextRequest, NextResponse } from "next/server";
import { verifyShareToken } from "@/lib/shareLink";
import { getFile } from "@/lib/files";
import { rateLimit, clientIpFrom, tooManyResponse } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Public (unauthenticated) artifact download behind a signed share token —
// this is what the /share/[token] page embeds and links to. Rate-limited per
// IP *and* globally, since every hit costs a Supabase Storage download.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const perIp = rateLimit("share-file-ip", clientIpFrom(req.headers), 20, 60_000);
  if (!perIp.ok) return tooManyResponse(perIp);
  const global = rateLimit("share-file-global", "all", 300, 60_000);
  if (!global.ok) return tooManyResponse(global);

  const share = verifyShareToken(params.token);
  if (!share.ok) {
    return NextResponse.json(
      { error: share.reason === "expired" ? "this share link has expired" : "invalid share link" },
      { status: share.reason === "expired" ? 410 : 404 }
    );
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "cover_letter" ? "cover_letter_pdf" : "resume_pdf";
  try {
    const file = await getFile(share.userId, share.applicationId, kind);
    if (!file) return NextResponse.json({ error: "file not available" }, { status: 404 });
    const inline = url.searchParams.get("download") !== "1";
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.meta.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    // Storage hiccups shouldn't leak internals on a public endpoint.
    return NextResponse.json({ error: "file not available" }, { status: 404 });
  }
}
