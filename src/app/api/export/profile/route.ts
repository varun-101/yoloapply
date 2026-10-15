import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { requireUser, apiError } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { getProjectBank } from "@/lib/projectBank";
import { getFile } from "@/lib/files";
import { buildProfilePackMarkdown, buildPackJson, packFilename } from "@/lib/export";

// Generic interview-prep export: the user's profile + project bank as a
// portable Markdown pack (?format=json for machines, ?format=zip to bundle
// the generic resume PDF alongside). No LLM call, plain fast GET.
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const [profile, projects] = await Promise.all([
      getProfile(user.id),
      getProjectBank(user.id),
    ]);

    const format = new URL(req.url).searchParams.get("format") ?? "md";
    const base = packFilename([profile.name, "Interview_Prep_Pack"]);

    if (format === "json") {
      return NextResponse.json(buildPackJson(profile, projects));
    }

    const markdown = buildProfilePackMarkdown(profile, projects);

    if (format === "zip") {
      const zip = new AdmZip();
      zip.addFile(`${base}.md`, Buffer.from(markdown, "utf-8"));
      const resume = await getFile(user.id, null, "generic_resume");
      if (resume) zip.addFile(resume.meta.filename, resume.data);
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
