import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { projectData, slugify, type ProjectBody } from "./shared";

// The user's project bank — the only material personalization may draw
// project facts from (no fabricated resume content, ever).

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ projects });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as ProjectBody;
    const data = projectData(body);
    if (!data.title || !data.oneLiner) {
      return NextResponse.json({ error: "title and one-liner are required" }, { status: 400 });
    }
    const slug = body.slug?.trim() || slugify(data.title) || `project-${Date.now()}`;
    try {
      const project = await prisma.project.create({
        data: { userId: user.id, slug, ...data },
      });
      return NextResponse.json({ project });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return NextResponse.json(
          { error: `you already have a project with the slug "${slug}"` },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (e) {
    return apiError(e);
  }
}
