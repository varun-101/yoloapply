import { describe, expect, it } from "vitest";
import { buildResumeTex, cleanBullet, masterResume, projectBullets, type ResumeDocument } from "../src/lib/resumeTemplate";
import type { CandidateProfile } from "../src/lib/profile";
import type { ProjectBankItem } from "../src/lib/projectBank";

const profile: CandidateProfile = {
  userId: "u1", name: "Test Candidate", email: "candidate@example.test", phone: "+91 99999 00000",
  github: "https://github.com/test", githubHandle: "test", linkedin: "https://www.linkedin.com/in/test/",
  linkedinHandle: "test", portfolio: "https://www.test.dev", city: "Pune", country: "India",
  yearsOfExperience: "1",
  education: { school: "Test College", degree: "Computer Engineering", degreeLevel: "BTech", start: "Jun 2022", grad: "Apr 2026", cgpa: "8.4" },
  experience: [{ title: "Intern", company: "Acme", period: "Jun 2025 - May 2026", location: "Mumbai", bullets: ["* Built a thing.", "Shipped & fixed 100% of bugs."] }],
  extras: [], applicationAnswers: {}, followUpDelayDays: 5, recruiterLocation: "",
};

const project = (slug: string, extra: Partial<ProjectBankItem> = {}): ProjectBankItem => ({
  slug, title: slug.toUpperCase(), subtitle: "", tagline: "", oneLiner: `Built ${slug}.`, problem: "",
  approach: `Implemented one.\n\nIntegrated two.`, outcome: "", techStack: ["TypeScript", "Postgres"],
  repoUrl: `https://github.com/test/${slug}`, year: "2025", featured: false, ...extra,
});

describe("master resume", () => {
  it("builds every section from the profile and the whole project bank", () => {
    const doc = masterResume(profile, [project("a", { liveUrl: "https://a.example/?x=1#top" }), project("b")]);
    expect(doc.contacts.map((c) => c.label)).toEqual([
      "Pune, India", "candidate@example.test", "+91 99999 00000", "github.com/test", "linkedin.com/in/test", "test.dev",
    ]);
    expect(doc.contacts[2].url).toBe("tel:+919999900000");
    expect(doc.education).toEqual({ school: "Test College", dates: "Jun 2022 - Apr 2026", degree: "BTech, Computer Engineering", detail: "GPA: 8.4" });
    expect(doc.experience[0].bullets).toEqual(["Built a thing.", "Shipped & fixed 100% of bugs."]);
    expect(doc.projects.map((p) => p.slug)).toEqual(["a", "b"]);
    // The live URL wins over the repo; blank approach lines are dropped.
    expect(doc.projects[0].url).toBe("https://a.example/?x=1#top");
    expect(doc.projects[1].url).toBe("https://github.com/test/b");
    expect(doc.projects[0].bullets).toEqual(["Built a.", "Implemented one.", "Integrated two."]);
    expect(doc.skills).toEqual([{ label: "Technologies", value: "TypeScript, Postgres" }]);
  });

  it("strips pasted bullet markers only at the start", () => {
    expect(cleanBullet("* Built X")).toBe("Built X");
    expect(cleanBullet("• Built X")).toBe("Built X");
    expect(cleanBullet("2) Built X")).toBe("Built X");
    expect(cleanBullet("Built X-Y * Z")).toBe("Built X-Y * Z");
    expect(projectBullets(project("c", { approach: "" }))).toEqual(["Built c."]);
  });
});

describe("resume LaTeX", () => {
  const doc: ResumeDocument = {
    ...masterResume(profile, [project("a", { liveUrl: "https://a.example/?x=1&y=2#top" })]),
    summary: "Engineer who ships workflows & fixes.",
  };

  it("escapes text, keeps link targets and breaks f-ligatures", () => {
    const tex = buildResumeTex(doc);
    expect(tex).toContain(String.raw`Shipped \& f{}ixed 100\% of bugs.`);
    expect(tex).toContain(String.raw`workf{}lows \& f{}ixes.`);
    expect(tex).toContain(String.raw`\href{https://a.example/?x=1\&y=2\#top}{\underline{A}}`);
    expect(tex).toContain(String.raw`\href{mailto:candidate@example.test}`);
    expect(tex).toContain("PROFESSIONAL SUMMARY");
    expect(tex).not.toContain("fontspec");
  });

  it("omits empty sections and scales every size together", () => {
    const bare = buildResumeTex({ ...doc, summary: "", skills: [], extras: [] });
    expect(bare).not.toContain("PROFESSIONAL SUMMARY");
    expect(bare).not.toContain("SKILLS");
    expect(bare).toContain(String.raw`\fontsize{7.5bp}{8.25bp}`);
    const big = buildResumeTex(doc, { scale: 1.2, extraGapPt: 2 });
    expect(big).toContain(String.raw`\fontsize{9bp}{9.9bp}`);
    expect(big).toContain(String.raw`\vspace{10.4bp}`); // 7 * 1.2 + 2 before each section
  });
});
