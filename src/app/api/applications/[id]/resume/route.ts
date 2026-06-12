import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { getFile } from "@/lib/files";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, company: true, role: true },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "pdf";

    if (format === "tex") {
      const file = await getFile(user.id, app.id, "resume_tex");
      if (!file) return NextResponse.json({ error: "no tex yet" }, { status: 404 });
      return new NextResponse(new Uint8Array(file.data), {
        headers: {
          "Content-Type": "text/x-tex; charset=utf-8",
          "Content-Disposition": `inline; filename="${app.company}_${app.role}.tex"`,
        },
      });
    }

    const file = await getFile(user.id, app.id, "resume_pdf");
    if (!file) return NextResponse.json({ error: "no pdf yet" }, { status: 404 });
    const inline = url.searchParams.get("download") !== "1";
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.meta.filename}"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
