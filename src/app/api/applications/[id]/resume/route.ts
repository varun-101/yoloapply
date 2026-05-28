import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readFile } from "fs/promises";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "pdf";

  if (format === "tex") {
    if (!app.resumeTexPath) return NextResponse.json({ error: "no tex yet" }, { status: 404 });
    const buf = await readFile(app.resumeTexPath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "text/x-tex; charset=utf-8",
        "Content-Disposition": `inline; filename="${app.company}_${app.role}.tex"`,
      },
    });
  }

  if (!app.resumePdfPath) return NextResponse.json({ error: "no pdf yet" }, { status: 404 });
  const buf = await readFile(app.resumePdfPath);
  const inline = url.searchParams.get("download") !== "1";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="Varun_Chandwani_${app.company}.pdf"`,
    },
  });
}
