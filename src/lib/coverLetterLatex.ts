import { CandidateProfile } from "./profile";
import { escTex } from "./latex";
import { CoverLetterDraft } from "./coverLetter";

// A clean single-page LaTeX cover letter, compiled via the same pipeline as the resume.
export function buildCoverLetterLatex(
  profile: CandidateProfile,
  draft: CoverLetterDraft,
  meta: { company: string; role: string }
): string {
  const e = (s: string) => escTex(s);
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const paras = draft.paragraphs.map((p) => e(p)).join("\n\n\\vspace{8pt}\n\n");

  const headerLinks = [
    profile.phone ? e(profile.phone) : null,
    `\\href{mailto:${profile.email}}{${e(profile.email)}}`,
    profile.github ? `\\href{${profile.github}}{GitHub}` : null,
    profile.linkedin ? `\\href{${profile.linkedin}}{LinkedIn}` : null,
    profile.portfolio ? `\\href{${profile.portfolio}}{Portfolio}` : null,
  ]
    .filter(Boolean)
    .join(" $\\cdot$ ");

  return String.raw`\documentclass[11pt,letterpaper]{article}
\usepackage[margin=1in]{geometry}
\usepackage[hidelinks]{hyperref}
\usepackage{parskip}
\usepackage[english]{babel}
\newcommand{\rupee}{\textbf{Rs.}}
\setlength{\parindent}{0pt}
\pagestyle{empty}

\begin{document}

{\Large \textbf{${e(profile.name)}}}\\[2pt]
\small ${headerLinks}

\vspace{14pt}
\normalsize ${e(date)}

\vspace{10pt}
Hiring Team\\
${e(meta.company)}

\vspace{6pt}
\textit{Re: ${e(meta.role)}}

\vspace{12pt}
${e(draft.salutation)}

\vspace{8pt}

${paras}

\vspace{12pt}
${e(draft.closing)}\\[6pt]
${e(profile.name)}

\end{document}
`;
}
