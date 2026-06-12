import { chatJson } from "./llm";
import { getProjectBank, ProjectBankItem } from "./projectBank";
import { getProfile, CandidateProfile } from "./profile";
import { getDeepseekKey } from "./credentials";
import { ResumeDraft } from "./latex";

const SYSTEM_PROMPT = `You are an expert technical resume writer helping a software engineer tailor their resume to a specific job description.

You produce concise, evidence-backed bullets. You NEVER fabricate metrics, employers, projects, or technologies that aren't supplied in the candidate's project bank or experience. You may rephrase existing facts to match the JD's vocabulary, but every claim must be traceable to the source material provided.

Output STRICT JSON only — no prose, no markdown fences.`;

interface PersonalizeInput {
  jobDescription: string;
  company: string;
  role: string;
  // 0 = normal, 1 = tight (overflow detected), 2 = very tight (still overflowing).
  // Higher values shrink the content envelope so it fits on one page.
  tightness?: 0 | 1 | 2;
}

function tightnessRules(t: 0 | 1 | 2): string {
  if (t === 0) {
    return [
      "- Pick 3-4 projects from the bank, 2-3 bullets each, each bullet <= 28 words.",
      "- Summary: 2 sentences.",
      "- Each experience entry: 2-3 bullets.",
    ].join("\n");
  }
  if (t === 1) {
    return [
      "- The previous draft overflowed one page. Be tighter.",
      "- Pick exactly 3 projects, exactly 2 bullets each, each bullet <= 22 words.",
      "- Summary: 1 sentence, <= 30 words.",
      "- Each experience entry: exactly 2 bullets, each <= 22 words.",
      "- Each skills group: at most 6 items.",
    ].join("\n");
  }
  return [
    "- The previous drafts still overflowed one page. Be very terse.",
    "- Pick exactly 3 projects, exactly 1 bullet each, each bullet <= 24 words and information-dense.",
    "- Summary: 1 sentence, <= 24 words.",
    "- Each experience entry: exactly 2 bullets, each <= 18 words.",
    "- Each skills group: at most 5 items. Drop low-value groups.",
  ].join("\n");
}

// Loaded once per personalize run and reused across one-page retries.
export interface PersonalizeContext {
  profile: CandidateProfile;
  projectBank: ProjectBankItem[];
  apiKey: string;
}

export async function loadPersonalizeContext(userId: string): Promise<PersonalizeContext> {
  const [profile, projectBank, apiKey] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getDeepseekKey(userId),
  ]);
  return { profile, projectBank, apiKey };
}

export async function personalizeResume(
  ctx: PersonalizeContext,
  input: PersonalizeInput
): Promise<ResumeDraft> {
  const { profile, projectBank, apiKey } = ctx;
  const candidate = {
    name: profile.name,
    education: profile.education,
    experience: profile.experience,
    extras: profile.extras,
  };

  const slugEnum = projectBank.map((p) => JSON.stringify(p.slug)).join(" | ") || '"<slug>"';

  const userPrompt = `# CANDIDATE
${JSON.stringify(candidate, null, 2)}

# PROJECT BANK (pick 3-4 most relevant)
${JSON.stringify(projectBank, null, 2)}

# TARGET JOB
Company: ${input.company}
Role: ${input.role}
Job Description:
"""
${input.jobDescription}
"""

# TASK
The resume MUST fit on a single US-letter page when rendered in LaTeX at 11pt. Follow the length rules strictly.

# LENGTH RULES
${tightnessRules(input.tightness ?? 0)}

1) Pick projects from the bank by slug, by best fit for THIS job.
2) For each project, write bullets that match the JD's vocabulary while staying faithful to its problem/approach/outcome. Lead with action verbs. Use real metrics from the bank.
3) Write a "summary" tailored to this role referencing concrete proof points the candidate has. No buzzword soup.
4) Re-order skill groups so JD-relevant skills appear first. You may add a "Highlights" group at the front with 4-6 technologies straight from the JD that the candidate genuinely has. Do not invent skills.
5) For EACH entry in the candidate's experience array (by zero-based index), rewrite its bullets emphasizing the aspects most relevant to this JD. Stay strictly truthful to the facts in the supplied bullets — rephrase, never invent.

# OUTPUT FORMAT (strict JSON)
{
  "summary": "string",
  "skillsOrdered": [
    { "group": "Highlights" | "Languages" | "Backend" | "Frontend" | "AI/ML" | "Infrastructure" | "Databases" | ..., "items": ["..."] }
  ],
  "selectedProjects": [
    {
      "slug": ${slugEnum},
      "bullets": ["...", "...", "..."]
    }
  ],
  "experienceBullets": [
    { "index": 0, "bullets": ["...", "..."] }
  ]
}`;

  type ModelOut = {
    summary: string;
    skillsOrdered: { group: string; items: string[] }[];
    selectedProjects: { slug: string; bullets: string[] }[];
    experienceBullets: { index: number; bullets: string[] }[];
  };
  const parsed = await chatJson<ModelOut>({
    apiKey,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 8192,
    temperature: 0.4,
  });

  // Hydrate selected projects with their stable metadata from the bank.
  const selectedProjects = parsed.selectedProjects
    .map((sp) => {
      const bank = projectBank.find((p) => p.slug === sp.slug);
      if (!bank) return null;
      return {
        slug: bank.slug,
        title: bank.title,
        bullets: sp.bullets,
        techStack: bank.techStack,
        repoUrl: bank.repoUrl,
        liveUrl: bank.liveUrl,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (selectedProjects.length === 0) {
    // Fallback: pick the 3 featured projects so we never produce an empty resume.
    const fallback: ProjectBankItem[] = projectBank.filter((p) => p.featured).slice(0, 3);
    for (const f of fallback) {
      selectedProjects.push({
        slug: f.slug,
        title: f.title,
        bullets: [f.oneLiner],
        techStack: f.techStack,
        repoUrl: f.repoUrl,
        liveUrl: f.liveUrl,
      });
    }
  }

  return {
    summary: parsed.summary,
    skillsOrdered: parsed.skillsOrdered,
    selectedProjects,
    experienceBullets: Array.isArray(parsed.experienceBullets) ? parsed.experienceBullets : [],
  };
}
