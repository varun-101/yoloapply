import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { ingestJob, type IngestJobInput } from "@/lib/application-agent/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as IngestJobInput;
    if (!body.url && !body.jdUrl && !body.applyUrl && !(body.company && (body.role || body.title))) {
      return NextResponse.json({ error: "A job URL or company and role are required." }, { status: 400 });
    }
    const result = await ingestJob(user.id, body);
    return NextResponse.json({
      id: result.application.id,
      applicationId: result.application.id,
      deduplicated: result.deduplicated,
    });
  } catch (error) {
    return apiError(error);
  }
}
