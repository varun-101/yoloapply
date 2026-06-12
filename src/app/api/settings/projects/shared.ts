// Shared between the projects collection route and the [id] detail route.

export interface ProjectBody {
  slug?: string;
  title?: string;
  subtitle?: string;
  tagline?: string;
  oneLiner?: string;
  problem?: string;
  approach?: string;
  outcome?: string;
  techStack?: string[];
  repoUrl?: string;
  liveUrl?: string;
  year?: string;
  featured?: boolean;
  sortOrder?: number;
}

export function projectData(body: ProjectBody) {
  const str = (v: string | undefined) => v?.trim() || null;
  return {
    title: body.title?.trim() ?? "",
    subtitle: str(body.subtitle),
    tagline: str(body.tagline),
    oneLiner: body.oneLiner?.trim() ?? "",
    problem: str(body.problem),
    approach: str(body.approach),
    outcome: str(body.outcome),
    techStack: Array.isArray(body.techStack)
      ? body.techStack.map((t) => String(t).trim()).filter(Boolean)
      : [],
    repoUrl: str(body.repoUrl),
    liveUrl: str(body.liveUrl),
    year: str(body.year),
    featured: !!body.featured,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
  };
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
