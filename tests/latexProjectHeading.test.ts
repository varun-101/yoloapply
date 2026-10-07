import { describe, expect, it } from "vitest";
import { buildLatexResume, escTex, type ResumeDraft, type Tightness } from "../src/lib/latex";
import type { CandidateProfile } from "../src/lib/profile";

const coverProfile: CandidateProfile = {
  userId: "test", name: "Test Candidate", email: "candidate@example.test", phone: "",
  github: "", githubHandle: "", linkedin: "", linkedinHandle: "", portfolio: "",
  city: "Pune", country: "India", yearsOfExperience: "1", education: null,
  experience: [], extras: [], applicationAnswers: {}, followUpDelayDays: 7, recruiterLocation: "",
};

describe("wrapping resume project headings", () => {
  it.each([0, 1, 2] as Tightness[])("bounds long headings without dropping saved text or links at tightness %i", (tightness) => {
    const project = {
      slug: "long-heading",
      title: "HackerRank Orchestrate — Assessment & Interview Platform",
      techStack: ["TypeScript", "Next.js", "React", "Node.js", "PostgreSQL", "Prisma", "Docker", "Redis", "REST APIs", "CI/CD"],
      repoUrl: "https://example.test/orchestrate?tab=code#readme",
      liveUrl: "https://example.test/orchestrate-live",
      bullets: ["Saved project bullet."],
    };
    const draft: ResumeDraft = { summary: "", skillsOrdered: [], experienceBullets: [], selectedProjects: [project] };
    const original = structuredClone(draft);
    const tex = buildLatexResume(coverProfile, draft, tightness);
    const macro = tex.slice(tex.indexOf(String.raw`\newcommand{\resumeProjectHeading}`), tex.indexOf(String.raw`\renewcommand\labelitemii`));

    // A paragraph column must get the remaining list width after links and gap,
    // rather than an unbounded l column or the wider document text width.
    expect(macro).toContain(String.raw`\sbox0{#2}`);
    expect(macro).toContain(String.raw`\linewidth-\wd0-1em\relax`);
    expect(macro).toContain(String.raw`\begin{tabular}[t]{@{}p{\projectHeadingWidth}@{\hspace{1em}}r@{}}`);
    expect(macro).toContain(String.raw`\raggedright\small#1 & #2`);
    expect(macro).not.toContain(String.raw`\textwidth`);
    expect(macro).not.toContain(String.raw`\tabular*`);
    expect(tex).toContain(escTex(project.title));
    expect(tex).toContain(escTex(project.techStack.join(", ")));
    expect(tex).toContain(`\\href{${project.repoUrl}}{\\underline{GitHub}}`);
    expect(tex).toContain(`\\href{${project.liveUrl}}{\\underline{Live}}`);
    expect(tex).toContain(String.raw`\item Saved project bullet.`);
    expect(draft).toEqual(original);
  });

  it("keeps a GitHub-only heading visible without adding a Live link", () => {
    const tex = buildLatexResume(coverProfile, {
      summary: "", skillsOrdered: [], experienceBullets: [], selectedProjects: [
        { slug: "short", title: "Saved title", techStack: ["TypeScript"], bullets: [], repoUrl: "https://example.test/repo" },
      ],
    });
    expect(tex).toContain(String.raw`{\textbf{Saved title} $|$ \small\emph{TypeScript}}{\href{https://example.test/repo}{\underline{GitHub}}}`);
    expect(tex).not.toContain(String.raw`\underline{Live}`);
  });
});
