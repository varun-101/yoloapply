import { escTex } from "./latex";
import type { CandidateProfile } from "./profile";
import type { ProjectBankItem } from "./projectBank";

// The resume every application starts from. Its design is a recreation of the
// candidate's own hand-made reference resume (compact sans-serif, ruled
// section headings, full-width bullets) rather than the old Jake's-template
// look. Content is the user's full profile + project bank; tailoring only
// rewrites words and reorders, and resumeFit.ts decides how much of it fits.

export interface ResumeContact {
  label: string;
  url?: string;
}

export interface ResumeEducation {
  school: string;
  dates: string;
  degree: string;
  detail: string; // "GPA: 8.4"
}

export interface ResumeExperience {
  company: string;
  title: string;
  location: string;
  dates: string;
  bullets: string[];
}

export interface ResumeSkillGroup {
  label: string;
  value: string;
}

export interface ResumeProject {
  slug: string;
  title: string;
  url?: string;
  bullets: string[];
}

export interface ResumeExtra {
  title: string;
  org: string;
  dates: string;
  summary: string;
}

export interface ResumeDocument {
  name: string;
  contacts: ResumeContact[];
  summary: string;
  education: ResumeEducation | null;
  experience: ResumeExperience[];
  skills: ResumeSkillGroup[];
  // Ordered most relevant first; the fitter keeps a prefix of this list.
  projects: ResumeProject[];
  extras: ResumeExtra[];
}

export interface ResumeLayout {
  // Multiplies every font size and gap. 1 = the reference resume's sizes
  // (7.5pt body); the fitter grows it when the content is short.
  scale: number;
  // Extra space added before each section and between projects, used to
  // spread a small leftover gap instead of leaving it all at the bottom.
  extraGapPt: number;
}

export const REFERENCE_LAYOUT: ResumeLayout = { scale: 1, extraGapPt: 0 };

// Profile bullets are often pasted with their own markers ("* Built ...").
export function cleanBullet(text: string): string {
  return text.replace(/^\s*(?:[*•▪◦‣-]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim();
}

function displayUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

function contactsFor(profile: CandidateProfile): ResumeContact[] {
  const out: ResumeContact[] = [];
  const location = [profile.city, profile.country].filter(Boolean).join(", ");
  if (location) out.push({ label: location });
  if (profile.email) out.push({ label: profile.email, url: `mailto:${profile.email}` });
  if (profile.phone) out.push({ label: profile.phone, url: `tel:${profile.phone.replace(/[^\d+]/g, "")}` });
  for (const url of [profile.github, profile.linkedin, profile.portfolio]) {
    if (url) out.push({ label: displayUrl(url), url });
  }
  return out;
}

function educationFor(profile: CandidateProfile): ResumeEducation | null {
  const edu = profile.education;
  if (!edu || !edu.school) return null;
  const degree = edu.degreeLevel
    ? [edu.degreeLevel, edu.discipline || edu.degree].filter(Boolean).join(", ")
    : edu.degree;
  const dates = edu.start && edu.grad ? `${edu.start} - ${edu.grad}` : edu.grad ?? "";
  return { school: edu.school, dates, degree, detail: edu.cgpa ? `GPA: ${edu.cgpa}` : "" };
}

// The project-bank fields already hold resume-ready sentences: the one-liner
// opens, and each line of `approach` is one implementation bullet.
export function projectBullets(p: ProjectBankItem): string[] {
  return [p.oneLiner, ...p.approach.split(/\r?\n/)].map(cleanBullet).filter(Boolean);
}

// Untailored skills line: every technology the candidate lists, deduplicated.
export function defaultSkills(projectBank: ProjectBankItem[]): ResumeSkillGroup[] {
  const seen = new Map<string, string>();
  for (const p of projectBank) {
    for (const t of p.techStack) {
      const key = t.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, t.trim());
    }
  }
  return seen.size ? [{ label: "Technologies", value: [...seen.values()].join(", ") }] : [];
}

export function masterResume(profile: CandidateProfile, projectBank: ProjectBankItem[]): ResumeDocument {
  return {
    name: profile.name,
    contacts: contactsFor(profile),
    summary: "",
    education: educationFor(profile),
    experience: profile.experience.map((x) => ({
      company: x.company,
      title: x.title,
      location: x.location ?? "",
      dates: x.period,
      bullets: x.bullets.map(cleanBullet).filter(Boolean),
    })),
    skills: defaultSkills(projectBank),
    projects: projectBank.map((p) => ({
      slug: p.slug,
      title: p.title,
      url: p.liveUrl || p.repoUrl || undefined,
      bullets: projectBullets(p),
    })),
    extras: profile.extras
      .filter((x) => x.title || x.org)
      .map((x) => ({ title: x.title, org: x.org, dates: x.period ?? "", summary: x.summary ?? "" })),
  };
}

// Escaped text with the f-ligatures broken up. Tectonic maps ligature glyphs
// to U+FB01/U+FB02 in the PDF text layer, so an ATS reading "workflows"
// would get "work" + U+FB02 + "ows"; "f{}l" typesets as two glyphs on every engine.
function tx(s: string): string {
  return escTex(s).replace(/f(?=[fil])/g, "f{}");
}

// URLs go inside \href{...}; only characters that break the argument need care.
function escUrl(url: string): string {
  return url.replace(/\\/g, "").replace(/([#%&{}])/g, "\\$1").replace(/[\s~^]/g, (c) => encodeURI(c));
}

function link(label: string, url?: string): string {
  return url ? `\\href{${escUrl(url)}}{\\underline{${tx(label)}}}` : tx(label);
}

function bulletList(items: string[]): string {
  if (!items.length) return "";
  return ["\\begin{itemize}", ...items.map((b) => `\\item ${tx(b)}`), "\\end{itemize}"].join("\n") + "\n";
}

function bp(n: number): string {
  return `${Math.round(n * 100) / 100}bp`;
}

export function buildResumeTex(doc: ResumeDocument, layout: ResumeLayout = REFERENCE_LAYOUT): string {
  const s = layout.scale;
  const gap = layout.extraGapPt;
  const out: string[] = [];

  out.push(String.raw`%--------------------------------------------------------------------
% YOLOapply generated resume. Regenerate via the app rather than editing.
% Layout: scale ${s.toFixed(3)}, extra gap ${gap.toFixed(2)}pt
%--------------------------------------------------------------------
\documentclass[letterpaper]{article}
\usepackage[left=36bp,right=36bp,top=${bp(18)},bottom=${bp(24)}]{geometry}
\usepackage[T1]{fontenc}
\usepackage{tgheros}
\renewcommand{\familydefault}{\sfdefault}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
% pdfTeX needs an explicit Unicode map; XeTeX/Tectonic already uses Unicode.
\ifdefined\pdfgentounicode
\input{glyphtounicode}
\pdfgentounicode=1
\fi
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\raggedright
\hyphenpenalty=10000
\exhyphenpenalty=10000
\newcommand{\rupee}{Rs.}
\setlist[itemize]{leftmargin=${bp(10.5 * s)},labelsep=${bp(6 * s)},label=\textbullet,itemsep=0bp,parsep=0bp,topsep=${bp(2.5 * s)},partopsep=0bp}
\newcommand{\ressection}[1]{\par\vspace{${bp(7 * s + gap)}}{\fontsize{${bp(8 * s)}}{${bp(9 * s)}}\selectfont\bfseries #1\par}\vspace{${bp(3 * s)}}\hrule height .65bp\vspace{${bp(6 * s)}}}
\newcommand{\resproject}[1]{\par\vspace{${bp(4 * s + gap / 2)}}{\bfseries #1\par}\nopagebreak}
\begin{document}
\fontsize{${bp(7.5 * s)}}{${bp(8.25 * s)}}\selectfont`);

  const contacts = doc.contacts.map((c) => link(c.label, c.url)).join(" | ");
  out.push(
    `{\\centering{\\fontsize{${bp(15.5 * s)}}{${bp(18 * s)}}\\selectfont\\bfseries ${tx(doc.name)}\\par}` +
      `\\vspace{${bp(7 * s)}}{\\fontsize{${bp(6 * s)}}{${bp(7 * s)}}\\selectfont ${contacts}\\par}}`
  );

  if (doc.summary.trim()) {
    out.push(`\\ressection{PROFESSIONAL SUMMARY}\n${tx(doc.summary.trim())}\\par`);
  }

  const edu = doc.education;
  if (edu) {
    out.push(
      `\\ressection{EDUCATION}\n\\textbf{${tx(edu.school)}}\\hfill ${tx(edu.dates)}\\par\n` +
        `${tx(edu.degree)}\\hfill ${tx(edu.detail)}\\par`
    );
  }

  if (doc.experience.length) {
    const entries = doc.experience.map((x, i) => {
      const heading = [x.company && `\\textbf{${tx(x.company)}}`, tx(x.title), tx(x.location)].filter(Boolean).join(" | ");
      const lead = i === 0 ? "" : `\\vspace{${bp(4 * s + gap / 2)}}`;
      return `${lead}${heading}\\hfill ${tx(x.dates)}\\par\n${bulletList(x.bullets)}`;
    });
    out.push(`\\ressection{WORK EXPERIENCE}\n${entries.join("")}`);
  }

  const skills = doc.skills.filter((g) => g.label.trim() && g.value.trim());
  if (skills.length) {
    const lines = skills.map((g) => `\\textbf{${tx(g.label.trim())}:} ${tx(g.value.trim())}\\par\\vspace{${bp(2 * s)}}`);
    out.push(`\\ressection{SKILLS}\n${lines.join("\n")}`);
  }

  if (doc.projects.length) {
    const entries = doc.projects.map((p, i) => {
      const title = link(p.title, p.url);
      const heading = i === 0 ? `{\\bfseries ${title}\\par}\n` : `\\resproject{${title}}\n`;
      return heading + bulletList(p.bullets);
    });
    out.push(`\\ressection{PROJECTS}\n${entries.join("")}`);
  }

  if (doc.extras.length) {
    const lines = doc.extras.map((x) => {
      const head = [x.title && `\\textbf{${tx(x.title)}}`, tx(x.org)].filter(Boolean).join(" | ");
      const body = x.summary ? `\n${bulletList([x.summary])}` : "\\par\n";
      return `${head}\\hfill ${tx(x.dates)}\\par${body}`;
    });
    out.push(`\\ressection{LEADERSHIP \\& ACTIVITIES}\n${lines.join("")}`);
  }

  out.push("\\end{document}\n");
  return out.join("\n");
}

// How many vertical slots extraGapPt is spread across, so the fitter can turn
// a measured leftover gap into a per-slot amount.
export function gapSlots(doc: ResumeDocument): number {
  const sections =
    (doc.summary.trim() ? 1 : 0) +
    (doc.education ? 1 : 0) +
    (doc.experience.length ? 1 : 0) +
    (doc.skills.length ? 1 : 0) +
    (doc.projects.length ? 1 : 0) +
    (doc.extras.length ? 1 : 0);
  const halfSlots = Math.max(0, doc.projects.length - 1) + Math.max(0, doc.experience.length - 1);
  return sections + halfSlots / 2;
}
