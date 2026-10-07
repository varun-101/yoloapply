import { describe, expect, it } from "vitest";
import { applyTailoring, filterSkills } from "../src/lib/personalize";
import { acceptRewrite, mentions, numbersIn, unknownTerms, type Grounding } from "../src/lib/resumeGrounding";
import type { ResumeDocument } from "../src/lib/resumeTemplate";

const master: ResumeDocument = {
  name: "T", contacts: [], summary: "", education: null, extras: [],
  skills: [{ label: "Technologies", value: "TypeScript, PostgreSQL" }],
  experience: [{ company: "Acme", title: "Intern", location: "", dates: "", bullets: ["Built loan APIs in TypeScript for 100 users.", "Ran CI/CD deploys for the backend team."] }],
  projects: [
    { slug: "a", title: "A", bullets: ["Built a search engine with BM25 over product docs.", "Added reranking to improve result relevance."] },
    { slug: "b", title: "B", bullets: ["Built a Chrome extension for media control."] },
    { slug: "c", title: "C", bullets: ["Built a desktop app for shared expenses."] },
  ],
};
const g: Grounding = {
  corpus: [
    "Acme Intern Built loan APIs in TypeScript for 100 users. Ran CI/CD deploys for the backend team.",
    "Built a search engine with BM25 over product docs. Added reranking to improve result relevance.",
    "Built a Chrome extension for media control. Built a desktop app for shared expenses.",
    "TypeScript PostgreSQL BM25 Chrome Extension APIs Node.js JavaScript",
  ].join("\n").toLowerCase(),
  techTerms: ["TypeScript", "PostgreSQL", "BM25", "Chrome Extension APIs"],
};

describe("applying the model's edits to the master resume", () => {
  it("takes ranked order, grounded rewrites and summary, and appends unranked projects", () => {
    const out = applyTailoring(master, {
      summary: "Backend engineer — ships TypeScript APIs and BM25 search.",
      projects: [
        { slug: "b", bullets: ["Shipped a Chrome extension for browser media control."] },
        { slug: "zzz", bullets: ["Invented project."] },
        { slug: "a", bullets: ["Built a BM25 search engine across product documentation.", "Added reranking to raise search result relevance."] },
      ],
      experience: [{ index: 0, bullets: ["Built TypeScript loan APIs serving 100 users.", "Ran CI/CD deployments for the backend team."] }],
    }, g);
    expect(out.projects.map((p) => p.slug)).toEqual(["b", "a", "c"]);
    expect(out.projects[0].bullets).toEqual(["Shipped a Chrome extension for browser media control."]);
    expect(out.projects[2].bullets).toEqual(master.projects[2].bullets);
    expect(out.experience[0].bullets).toEqual(["Built TypeScript loan APIs serving 100 users.", "Ran CI/CD deployments for the backend team."]);
    // deAi turns the em dash into a comma.
    expect(out.summary).toBe("Backend engineer, ships TypeScript APIs and BM25 search.");
    expect(master.projects[0].bullets[0]).toBe("Built a search engine with BM25 over product docs.");
  });

  it("keeps the originals when the model merges, balloons, guts or changes facts", () => {
    const out = applyTailoring(master, {
      projects: [
        { slug: "a", bullets: ["One merged bullet."] },
        { slug: "b", bullets: ["Built a Chrome extension that " + "really ".repeat(20) + "works."] },
        { slug: "c", bullets: ["Done."] },
      ],
      experience: [{ index: 0, bullets: ["Built Rust loan APIs serving 999 users.", "Ran CI/CD deploys for the platform group."] }],
    }, g);
    expect(out.projects.find((p) => p.slug === "a")!.bullets).toEqual(master.projects[0].bullets);
    expect(out.projects.find((p) => p.slug === "b")!.bullets).toEqual(master.projects[1].bullets);
    expect(out.projects.find((p) => p.slug === "c")!.bullets).toEqual(master.projects[2].bullets);
    expect(out.experience[0].bullets).toEqual([master.experience[0].bullets[0], "Ran CI/CD deploys for the platform group."]);
  });

  it("rejects an ungrounded summary and text the font cannot show", () => {
    const out = applyTailoring(master, {
      summary: "Former Google engineer who built TypeScript APIs.",
      projects: [{ slug: "b", bullets: ["Built a Chrome extension for media control (媒体)."] }],
    }, g);
    expect(out.summary).toBe("");
    expect(out.projects.find((p) => p.slug === "b")!.bullets).toEqual(master.projects[1].bullets);
  });

  it("falls back to the master on malformed output", () => {
    const out = applyTailoring(master, { summary: 42, projects: "nope", experience: null, skills: {} }, g);
    expect(out.projects).toEqual(master.projects);
    expect(out.experience).toEqual(master.experience);
    expect(out.summary).toBe("");
    expect(out.skills).toEqual(master.skills);
  });
});

describe("grounding checks", () => {
  it("matches whole terms only", () => {
    expect(mentions(g.corpus, "Go")).toBe(false);
    expect(mentions(g.corpus, "Java")).toBe(false);
    expect(mentions(g.corpus, "C")).toBe(false);
    expect(mentions(g.corpus, "JavaScript")).toBe(true);
    expect(mentions(g.corpus, "Node.js")).toBe(true);
    expect(mentions(g.corpus, "CI/CD")).toBe(true);
  });

  it("flags names and figures the candidate never mentioned", () => {
    expect(unknownTerms("Built APIs at Google for 5000 users.", g.corpus)).toEqual(["Google", "5000"]);
    expect(unknownTerms("Shipped search. Added BM25 reranking.", g.corpus)).toEqual([]);
    // Compounds pass when their capitalised parts are known; JD-only labels do not.
    expect(unknownTerms("Shipped TypeScript-generated APIs.", g.corpus)).toEqual([]);
    expect(unknownTerms("Shipped semantic NLP search for SaaS tenants.", g.corpus)).toEqual(["NLP", "SaaS"]);
  });

  it("treats digits inside names as part of the name, not as figures", () => {
    expect(numbersIn("Used OAuth2 and S3 for 100 users across 4-8 regions.")).toEqual(["100", "4", "8"]);
  });

  it("requires figures and named technologies to survive a rewrite", () => {
    const orig = "Built loan APIs in TypeScript for 100 users.";
    expect(acceptRewrite(orig, "Built TypeScript loan APIs for 100 users.", g)).toBe(true);
    expect(acceptRewrite(orig, "Built loan APIs for 100 users quickly.", g)).toBe(false);
    expect(acceptRewrite(orig, "Built TypeScript loan APIs for 1000 users.", g)).toBe(false);
  });
});

describe("skills the resume may list", () => {
  it("keeps only technologies the candidate's own material mentions as whole terms", () => {
    // "google chrome javascript" contains go, c and java only inside words.
    const corpus = `${g.corpus}\ngoogle chrome javascript`;
    const groups = filterSkills(
      [
        { label: "Backend", items: ["Node.js", "Kubernetes", "PostgreSQL", "postgresql"] },
        { label: "Languages", items: ["Go", "Java", "C", "JavaScript"] },
        { label: "DevOps", value: "CI/CD, Terraform" },
      ],
      corpus,
      master.skills
    );
    expect(groups).toEqual([
      { label: "Backend", value: "Node.js, PostgreSQL" },
      { label: "Languages", value: "JavaScript" },
      { label: "DevOps", value: "CI/CD" },
    ]);
  });
});
