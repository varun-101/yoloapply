import { owner } from "./owner";
import { ProjectBankItem } from "./projects";

// LaTeX escape: escape characters that have special meaning in LaTeX.
export function escTex(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/—/g, "---")
    .replace(/–/g, "--")
    .replace(/₹/g, "\\rupee{}")
    .replace(/“|”/g, '"')
    .replace(/‘|’/g, "'");
}

export interface ResumeDraft {
  // Personalization output from the AI:
  summary: string; // 2-line targeted summary
  skillsOrdered: { group: string; items: string[] }[];
  selectedProjects: {
    slug: string;
    title: string;
    bullets: string[]; // 2-3 bullets tailored to the JD
    techStack: string[];
    repoUrl: string;
    liveUrl?: string;
  }[];
  experienceBullets: string[]; // tailored bullets for the Loan for India internship
  // optionally swap target role line:
  targetRole?: string;
}

export type Tightness = 0 | 1 | 2;

export function buildLatexResume(draft: ResumeDraft, tightness: Tightness = 0): string {
  const e = (s: string) => escTex(s);

  const skillsBlock = draft.skillsOrdered
    .map((g) => `  \\textbf{${e(g.group)}:} ${e(g.items.join(", "))}`)
    .join(" \\\\\n");

  const projectsBlock = draft.selectedProjects
    .map((p) => {
      const links = [
        `\\href{${p.repoUrl}}{\\underline{GitHub}}`,
        p.liveUrl ? `\\href{${p.liveUrl}}{\\underline{Live}}` : null,
      ]
        .filter(Boolean)
        .join(" \\,$\\cdot$\\, ");
      const bullets = p.bullets.map((b) => `    \\item ${e(b)}`).join("\n");
      return `\\resumeProjectHeading
  {\\textbf{${e(p.title)}} $|$ \\small\\emph{${e(p.techStack.join(", "))}}}{${links}}
  \\resumeItemListStart
${bullets}
  \\resumeItemListEnd`;
    })
    .join("\n\n");

  const experienceBullets = draft.experienceBullets
    .map((b) => `    \\item ${e(b)}`)
    .join("\n");

  // Font size + vertical spacing tightens as we ratchet up to enforce a 1-page limit.
  const docFontSize = tightness >= 2 ? "10pt" : "11pt";
  const topMarginAdj = tightness === 0 ? "-.5in" : tightness === 1 ? "-.6in" : "-.75in";
  const sideMarginAdj = tightness === 0 ? "-0.5in" : "-0.6in";
  const textWidthAdj = tightness === 0 ? "1in" : "1.2in";
  const textHeightAdj = tightness === 0 ? "1.0in" : tightness === 1 ? "1.2in" : "1.5in";
  const sectionSkip = tightness === 0 ? "-4pt" : tightness === 1 ? "-6pt" : "-8pt";
  const itemSkip = tightness === 0 ? "-5pt" : tightness === 1 ? "-6pt" : "-7pt";

  return String.raw`%--------------------------------------------------------------------
% YOLOapply generated resume — DO NOT EDIT MANUALLY (regenerate via the app)
% Tightness: ${tightness} (0 = normal, 1 = tight, 2 = very tight)
%--------------------------------------------------------------------
\documentclass[letterpaper,${docFontSize}]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{xcolor}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{${sideMarginAdj}}
\addtolength{\evensidemargin}{${sideMarginAdj}}
\addtolength{\textwidth}{${textWidthAdj}}
\addtolength{\topmargin}{${topMarginAdj}}
\addtolength{\textheight}{${textHeightAdj}}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{\vspace{${sectionSkip}}\scshape\raggedright\large}{}{0em}{}[\color{black}\titlerule\vspace{${itemSkip}}]

\pdfgentounicode=1

% A rupee macro (not all engines have one; this stays ASCII-safe)
\newcommand{\rupee}{\textbf{Rs.}}

\newcommand{\resumeItem}[1]{\item\small{#1 \vspace{-2pt}}}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\begin{document}

% ----------HEADER----------
\begin{center}
  \textbf{\Huge \scshape ${e(owner.name)}} \\ \vspace{1pt}
  \small ${e(owner.phone)} $|$ \href{mailto:${owner.email}}{\underline{${e(owner.email)}}} $|$
  \href{${owner.github}}{\underline{GitHub}} $|$
  \href{${owner.linkedin}}{\underline{LinkedIn}} $|$
  \href{${owner.portfolio}}{\underline{Portfolio}}
\end{center}

% ----------SUMMARY----------
\vspace{2pt}\noindent\small ${e(draft.summary)}\vspace{-6pt}

% ----------SKILLS----------
\section{Skills}
\begin{itemize}[leftmargin=0.15in, label={}]\small{\item{
${skillsBlock}
}}\end{itemize}\vspace{-10pt}

% ----------EXPERIENCE----------
\section{Experience}
\resumeSubHeadingListStart
\resumeSubheading
  {Backend Software Engineer Intern}{June 2025 -- May 2026}
  {Loan for India}{Mumbai, India}
  \resumeItemListStart
${experienceBullets}
  \resumeItemListEnd
\resumeSubHeadingListEnd

% ----------PROJECTS----------
\section{Projects}
\resumeSubHeadingListStart
${projectsBlock}
\resumeSubHeadingListEnd

% ----------EDUCATION----------
\section{Education}
\resumeSubHeadingListStart
\resumeSubheading
  {Thadomal Shahani Engineering College}{Expected ${e(owner.education.grad)}}
  {B.E. in ${e(owner.education.degree)} (CGPA ${e(owner.education.cgpa)})}{}
\resumeSubHeadingListEnd

\end{document}
`;
}
