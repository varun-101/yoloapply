import { CandidateProfile } from "./profile";
import { ProjectBankItem } from "./projectBank";

// Interview-prep export packs: serialize the same candidate facts the
// interview engine runs on (profile + project bank, and for the
// application pack the target JD) into a portable Markdown/JSON file the
// user can hand to any third-party AI tool. Deliberately excludes email
// and phone: these files get pasted into external services, and an AI
// coach only needs the public links.

export interface ApplicationExportInfo {
  company: string;
  role: string;
  location: string | null;
  status: string;
  jdUrl: string | null;
  jdText: string | null;
  applyUrl: string | null;
  notes: string | null;
  coverLetterText: string | null;
  appliedAt: Date | null;
}

const GENERIC_PROMPT = `You are my interview coach. Below is my real background: my education, work experience, and the projects I have built. Ground everything in these facts only; never invent details about me, and if something is not covered here, ask me instead of assuming. Run a realistic mock interview for a junior software engineering role: ask one question at a time, dig deeper on my answers before moving on, and at the end give me honest feedback on strengths, gaps, and what to improve.`;

function applicationPrompt(company: string, role: string): string {
  return `You are my interview coach for an upcoming interview at ${company} for the role of ${role}. Below is my real background (education, experience, projects) and the job description, plus the materials I applied with. Ground everything in these facts only; never invent details about me, and if something is not covered here, ask me instead of assuming. Run a realistic mock interview for this specific role: ask one question at a time, cross-question my answers the way a real interviewer would, probe how my projects map to the job description, and at the end give me honest feedback on strengths, gaps, and what to improve.`;
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

function line(label: string, value?: string | null): string {
  return value ? `- **${label}:** ${value}\n` : "";
}

function candidateMarkdown(profile: CandidateProfile, projects: ProjectBankItem[]): string {
  let md = "";

  let about = "";
  about += line("Name", profile.name);
  const loc = [profile.city, profile.country].filter(Boolean).join(", ");
  about += line("Location", loc);
  about += line("Experience level", profile.yearsOfExperience);
  about += line("GitHub", profile.github);
  about += line("LinkedIn", profile.linkedin);
  about += line("Portfolio", profile.portfolio);
  md += section("Candidate", about);

  if (profile.education) {
    const e = profile.education;
    let edu = `- **${e.degree}**, ${e.school}`;
    if (e.cgpa) edu += ` (CGPA ${e.cgpa})`;
    if (e.grad) edu += `, graduating ${e.grad}`;
    md += section("Education", edu);
  }

  if (profile.experience.length > 0) {
    const exp = profile.experience
      .map((x) => {
        let s = `### ${x.title}, ${x.company}`;
        const meta = [x.period, x.location].filter(Boolean).join(" · ");
        if (meta) s += `\n*${meta}*`;
        if (x.bullets.length > 0) {
          s += "\n\n" + x.bullets.map((b) => `- ${b}`).join("\n");
        }
        return s;
      })
      .join("\n\n");
    md += section("Work experience", exp);
  }

  if (projects.length > 0) {
    const proj = projects
      .map((p) => {
        let s = `### ${p.title}`;
        if (p.year) s += ` (${p.year})`;
        if (p.oneLiner) s += `\n${p.oneLiner}`;
        s += "\n";
        s += line("Problem", p.problem);
        s += line("Approach", p.approach);
        s += line("Outcome", p.outcome);
        s += line("Tech stack", p.techStack.join(", "));
        s += line("Repo", p.repoUrl);
        s += line("Live", p.liveUrl);
        return s.trimEnd();
      })
      .join("\n\n");
    md += section("Projects", proj);
  }

  if (profile.extras.length > 0) {
    const extras = profile.extras
      .map((x) => {
        let s = `- **${x.title}**, ${x.org}`;
        if (x.period) s += ` (${x.period})`;
        if (x.summary) s += `: ${x.summary}`;
        return s;
      })
      .join("\n");
    md += section("Activities & extras", extras);
  }

  return md;
}

function header(title: string, name: string, prompt: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return (
    `# ${title}\n\n` +
    `> Exported from YOLOapply on ${date} for ${name}. Candidate background comes from the saved profile and project bank. Job details and application materials are included as saved.\n\n` +
    `## Suggested prompt\n\n` +
    `Paste this file into the AI tool of your choice, starting with:\n\n` +
    `> ${prompt}\n\n---\n\n`
  );
}

export function buildProfilePackMarkdown(
  profile: CandidateProfile,
  projects: ProjectBankItem[]
): string {
  return (
    header("Interview prep pack (general)", profile.name, GENERIC_PROMPT) +
    candidateMarkdown(profile, projects)
  );
}

export function buildApplicationPackMarkdown(
  profile: CandidateProfile,
  projects: ProjectBankItem[],
  app: ApplicationExportInfo
): string {
  let md = header(
    `Interview prep pack: ${app.company}, ${app.role}`,
    profile.name,
    applicationPrompt(app.company, app.role)
  );

  let job = "";
  job += line("Company", app.company);
  job += line("Role", app.role);
  job += line("Location", app.location);
  job += line("Application status", app.status);
  if (app.appliedAt) job += line("Applied on", app.appliedAt.toISOString().slice(0, 10));
  job += line("Job posting", app.jdUrl ?? app.applyUrl);
  job += line("Notes", app.notes);
  md += section("The job", job);

  if (app.jdText) {
    md += section("Job description", app.jdText);
  } else {
    md += section(
      "Job description",
      "*No job description is saved for this application. Add one on the application page for a sharper prep pack.*"
    );
  }

  md += candidateMarkdown(profile, projects);

  if (app.coverLetterText) {
    md += section("Saved cover letter", app.coverLetterText);
  }

  return md;
}

// JSON variant: the same facts as a machine-readable object.
export function buildPackJson(
  profile: CandidateProfile,
  projects: ProjectBankItem[],
  app?: ApplicationExportInfo
): object {
  const candidate = {
    name: profile.name,
    city: profile.city || null,
    country: profile.country || null,
    yearsOfExperience: profile.yearsOfExperience || null,
    github: profile.github || null,
    linkedin: profile.linkedin || null,
    portfolio: profile.portfolio || null,
    education: profile.education,
    experience: profile.experience,
    extras: profile.extras,
    projects,
  };
  if (!app) return { kind: "profile_pack", exportedAt: new Date().toISOString(), candidate };
  return {
    kind: "application_pack",
    exportedAt: new Date().toISOString(),
    job: {
      company: app.company,
      role: app.role,
      location: app.location,
      status: app.status,
      appliedAt: app.appliedAt?.toISOString() ?? null,
      jdUrl: app.jdUrl,
      applyUrl: app.applyUrl,
      jdText: app.jdText,
      notes: app.notes,
      coverLetterText: app.coverLetterText,
    },
    candidate,
  };
}

// "Varun Chandwani" → "Varun_Chandwani_Interview_Pack" (same sanitizer family
// as resumeFilename in profile.ts).
export function packFilename(parts: (string | null | undefined)[]): string {
  const clean = (s: string) => s.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_");
  return parts.filter((p): p is string => !!p).map(clean).filter(Boolean).join("_");
}
