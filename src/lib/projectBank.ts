import { prisma } from "./db";

// Per-user project bank (Project table). Replaces the old hardcoded
// PROJECT_BANK module; the item shape is unchanged so prompt builders read
// the same.

export interface ProjectBankItem {
  slug: string;
  title: string;
  subtitle: string;
  tagline: string;
  oneLiner: string;
  problem: string;
  approach: string;
  outcome: string;
  techStack: string[];
  repoUrl: string;
  liveUrl?: string;
  year: string;
  featured: boolean;
}

export async function getProjectBank(userId: string): Promise<ProjectBankItem[]> {
  const rows = await prisma.project.findMany({
    where: { userId },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle ?? "",
    tagline: r.tagline ?? "",
    oneLiner: r.oneLiner,
    problem: r.problem ?? "",
    approach: r.approach ?? "",
    outcome: r.outcome ?? "",
    techStack: r.techStack,
    repoUrl: r.repoUrl ?? "",
    liveUrl: r.liveUrl ?? undefined,
    year: r.year ?? "",
    featured: r.featured,
  }));
}
