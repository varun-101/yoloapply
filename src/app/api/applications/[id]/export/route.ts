import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { getProjectBank } from "@/lib/projectBank";
import { getFile } from "@/lib/files";
import { buildApplicationPackMarkdown, buildPackJson, packFilename } from "@/lib/export";

// Application-specific interview-prep export: profile + projects + this
// job's JD and applied-with materials. ?format=md (default) | json | zip
// (zip adds the personalized resume PDF, falling back to the generic one,
// plus the LaTeX source when present).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        company: true,
        role: true,
        location: true,
        status: true,
        jdUrl: true,
        jdText: true,
        applyUrl: true,
        notes: true,
        coverLetterText: true,
        appliedAt: true,
      },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

    const [profile, projects] = await Promise.all([
      getProfile(user.id),
      getProjectBank(user.id),
    ]);

    const format = new URL(req.url).searchParams.get("format") ?? "md";
    const base = packFilename([app.company, app.role, "Interview_Pack"]);

    if (format === "json") {
      return NextResponse.json(buildPackJson(profile, projects, app));
    }

    const markdown = buildApplicationPackMarkdown(profile, projects, app);

    if (format === "zip") {
      const zip = new AdmZip();
      zip.addFile(`${base}.md`, Buffer.from(markdown, "utf-8"));
      const resume =
        (await getFile(user.id, app.id, "resume_pdf")) ??
        (await getFile(user.id, null, "generic_resume"));
      if (resume) zip.addFile(resume.meta.filename, resume.data);
      const tex = await getFile(user.id, app.id, "resume_tex");
      if (tex) zip.addFile(tex.meta.filename, tex.data);
      return new NextResponse(new Uint8Array(zip.toBuffer()), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${base}.zip"`,
        },
      });
    }

    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.md"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
