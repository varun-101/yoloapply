import { describe, expect, it } from "vitest";
import { normalizeResumeImport } from "@/lib/resumeImport";

describe("normalizeResumeImport", () => {
  it("normalizes a model response and derives profile handles", () => {
    expect(
      normalizeResumeImport({
        name: " Ada Lovelace ",
        email: "ada@example.com",
        github: "https://github.com/ada-l",
        linkedin: "https://www.linkedin.com/in/ada-lovelace/",
        education: { degree: "BSc Mathematics", school: "University of London" },
        experience: [
          {
            title: "Engineer",
            company: "Analytical Engines",
            bullets: [" Built an engine. ", "", 42],
          },
          { bullets: ["not a real experience entry"] },
        ],
        extras: [{ title: "Award", org: "Royal Society", summary: " First. " }],
      })
    ).toMatchObject({
      name: "Ada Lovelace",
      githubHandle: "ada-l",
      linkedinHandle: "ada-lovelace",
      education: {
        degree: "BSc Mathematics",
        school: "University of London",
        cgpa: "",
        grad: "",
      },
      experience: [
        {
          title: "Engineer",
          company: "Analytical Engines",
          period: "",
          location: "",
          bullets: ["Built an engine."],
        },
      ],
      extras: [{ title: "Award", org: "Royal Society", period: "", summary: "First." }],
    });
  });

  it("drops malformed fields instead of coercing or inventing values", () => {
    expect(
      normalizeResumeImport({
        name: 42,
        education: "University",
        experience: [{ title: null, company: false }, "bad"],
        extras: null,
      })
    ).toEqual({
      name: "",
      email: "",
      phone: "",
      city: "",
      country: "",
      yearsOfExperience: "",
      github: "",
      githubHandle: "",
      linkedin: "",
      linkedinHandle: "",
      portfolio: "",
      education: null,
      experience: [],
      extras: [],
    });
  });

  it("does not derive handles from lookalike domains", () => {
    const profile = normalizeResumeImport({
      github: "https://notgithub.com/fake-user",
      linkedin: "https://evil-linkedin.com/in/fake-user",
    });

    expect(profile.githubHandle).toBe("");
    expect(profile.linkedinHandle).toBe("");
  });
});
