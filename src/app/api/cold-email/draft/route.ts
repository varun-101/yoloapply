import { NextRequest, NextResponse } from "next/server";
import { draftColdEmail } from "@/lib/coldEmail";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { company, recipientName, recipientTitle, role, hookContext } = body ?? {};
  if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });
  try {
    const draft = await draftColdEmail({ company, recipientName, recipientTitle, role, hookContext });
    return NextResponse.json(draft);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
