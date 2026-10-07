import { describe, expect, it } from "vitest";
import { applyTailoring, filterSkills } from "../src/lib/personalize";
import type { ResumeDocument } from "../src/lib/resumeTemplate";

const master: ResumeDocument = {
  name: "T", contacts: [], summary: "", education: null, extras: [],
  skills: [{ label: "Technologies", value: "TypeScript, PostgreSQL" }],
  experience: [{ company: "C", title: "Intern", location: "", dates: "", bullets: ["Built loan APIs in TypeScript.", "Ran CI/CD deploys."] }],
  projects: [
    { slug: "a", title: "A", bullets: ["Built a search engine with BM25.", "Added reranking."] },
    { slug: "b", title: "B", bullets: ["Built a Chrome extension."] },
    { slug: "c", title: "C", bullets: ["Built a desktop app."] },
  ],
};
const corpus = "TypeScript PostgreSQL BM25 CI/CD Chrome Extension APIs Node.js";

describe("applying the model's edits to the master resume", () => {
  it("takes ranked order, rewrites and summary, and appends unranked projects", () => {
    const out = applyTailoring(master, {
      summary: "Backend engineer — ships search.",
      projects: [
        { slug: "b", bullets: ["Shipped a Chrome extension."] },
        { slug: "zzz", bullets: ["Invented project."] },
        { slug: "a", bullets: ["Built a BM25 search engine.", "Added reranking for relevance."] },
      ],
      experience: [{ index: 0, bullets: ["Built TypeScript loan APIs.", "Ran CI/CD deployments."] }],
    }, corpus);
    expect(out.projects.map((p) => p.slug)).toEqual(["b", "a", "c"]);
    expect(out.projects[0].bullets).toEqual(["Shipped a Chrome extension."]);
    expect(out.projects[2].bullets).toEqual(["Built a desktop app."]);
    expect(out.experience[0].bullets).toEqual(["Built TypeScript loan APIs.", "Ran CI/CD deployments."]);
    // deAi turns the em dash into a comma.
    expect(out.summary).toBe("Backend engineer, ships search.");
    expect(master.projects[0].bullets).toEqual(["Built a search engine with BM25.", "Added reranking."]);
  });

  it("keeps the originals when the model merges bullets or balloons them", () => {
    const out = applyTailoring(master, {
      projects: [
        { slug: "a", bullets: ["One merged bullet."] },
        { slug: "b", bullets: ["Built a Chrome extension that " + "really ".repeat(20) + "works."] },
      ],
      experience: [{ index: 0, bullets: ["Built loan APIs.", ""] }],
    }, corpus);
    expect(out.projects.find((p) => p.slug === "a")!.bullets).toEqual(master.projects[0].bullets);
    expect(out.projects.find((p) => p.slug === "b")!.bullets).toEqual(master.projects[1].bullets);
    expect(out.experience[0].bullets).toEqual(["Built loan APIs.", "Ran CI/CD deploys."]);
  });

  it("falls back to the master on malformed output", () => {
    const out = applyTailoring(master, { summary: 42, projects: "nope", experience: null, skills: {} }, corpus);
    expect(out.projects).toEqual(master.projects);
    expect(out.experience).toEqual(master.experience);
    expect(out.summary).toBe("");
    expect(out.skills).toEqual(master.skills);
  });
});

describe("skills the resume may list", () => {
  it("keeps only technologies the candidate's own material mentions", () => {
    const groups = filterSkills(
      [
        { label: "Backend", items: ["Node.js", "Kubernetes", "PostgreSQL", "postgresql"] },
        { label: "Cloud", items: ["AWS", "GCP"] },
        { label: "DevOps", value: "CI/CD, Terraform" },
      ],
      corpus,
      master.skills
    );
    expect(groups).toEqual([
      { label: "Backend", value: "Node.js, PostgreSQL" },
      { label: "DevOps", value: "CI/CD" },
    ]);
  });
});
