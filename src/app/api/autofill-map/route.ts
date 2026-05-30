import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mapAutofill, FormFieldSpec } from "@/lib/autofillMap";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fields = Array.isArray(body.fields) ? (body.fields as FormFieldSpec[]) : [];
  if (fields.length === 0) {
    return NextResponse.json({ error: "fields array required" }, { status: 400 });
  }
  // Cap to keep the prompt sane.
  const trimmed = fields.slice(0, 60);

  let jd = typeof body.jobDescription === "string" ? body.jobDescription : undefined;
  let company = typeof body.company === "string" ? body.company : undefined;
  let role = typeof body.role === "string" ? body.role : undefined;

  if (body.applicationId) {
    const app = await prisma.application.findUnique({ where: { id: body.applicationId } });
    if (app) {
      jd = jd ?? app.jdText ?? undefined;
      company = company ?? app.company;
      role = role ?? app.role;
    }
  }

  try {
    const mapped = await mapAutofill({ fields: trimmed, jobDescription: jd, company, role });
    return NextResponse.json({ fields: mapped });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
