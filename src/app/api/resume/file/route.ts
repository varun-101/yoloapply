import { NextRequest, NextResponse } from "next/server";
import { readGenericResume } from "@/lib/genericResume";

export async function GET(req: NextRequest) {
  const buf = await readGenericResume();
  if (!buf) return NextResponse.json({ error: "no generic resume uploaded" }, { status: 404 });
  const inline = new URL(req.url).searchParams.get("download") !== "1";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="Varun_Chandwani_Resume.pdf"`,
    },
  });
}
