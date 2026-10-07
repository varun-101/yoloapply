import { chatJson, deAi, type LlmConfig } from "./llm";
import { getProjectBank, ProjectBankItem } from "./projectBank";
import { getProfile, CandidateProfile } from "./profile";
import { getLlmConfig } from "./credentials";
import { systemFor } from "./prompts";
import { defaultSkills, masterResume, type ResumeDocument, type ResumeSkillGroup } from "./resumeTemplate";

// Tailoring edits the words of the user's master resume (resumeTemplate.ts)
// toward one job description. It does not decide how much fits on the page:
// the model keeps every bullet at roughly its original length and ranks the
// projects, and resumeFit.ts then keeps as many as the page holds.

interface PersonalizeInput {
  jobDescription: string;
  company: string;
  role: string;
}

// Loaded once per personalize run.
export interface PersonalizeContext {
  profile: CandidateProfile;
  projectBank: ProjectBankItem[];
  llmCfg: LlmConfig;
  system: string; // built-in prompt + the user's Settings → Writing instructions
}

export async function loadPersonalizeContext(userId: string): Promise<PersonalizeContext> {
  const [profile, projectBank, llmCfg, system] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
    systemFor(userId, "resume"),
  ]);
  return { profile, projectBank, llmCfg, system };
}

export interface TailoringOutput {
  summary?: unknown;
  skills?: unknown;
  experience?: unknown;
  projects?: unknown;
}

// A rewritten bullet may drift this far from the original's word count before
// it is discarded; the page fill depends on lengths staying put.
const MAX_LENGTH_RATIO = 1.35;
const MAX_SUMMARY_WORDS = 55;
const MAX_SKILL_GROUPS = 7;

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function str(v: unknown): string {
  return typeof v === "string" ? deAi(v.replace(/\s+/g, " ").trim()) : "";
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// Same bullets in the same order, each replaced by its rewrite only when the
// rewrite is present and about the same length. A wrong count means the model
// merged or split bullets, so the originals are kept whole.
function rewriteBullets(original: string[], proposed: unknown): string[] {
  const next = list(proposed).map(str);
  if (next.length !== original.length) return original;
  return original.map((orig, i) => {
    const b = next[i];
    if (!b) return orig;
    return words(b) <= Math.max(words(orig) * MAX_LENGTH_RATIO, words(orig) + 4) ? b : orig;
  });
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

// Every skill the resume lists must already appear somewhere in the
// candidate's own material; the model may group and order, not add.
export function filterSkills(proposed: unknown, corpus: string, fallback: ResumeSkillGroup[]): ResumeSkillGroup[] {
  const haystack = norm(corpus);
  const groups: ResumeSkillGroup[] = [];
  for (const g of list(proposed).slice(0, MAX_SKILL_GROUPS)) {
    if (!g || typeof g !== "object") continue;
    const label = str((g as Record<string, unknown>).label);
    const raw = (g as Record<string, unknown>).items ?? (g as Record<string, unknown>).value;
    const items = (Array.isArray(raw) ? raw.map(str) : str(raw).split(","))
      .map((s) => s.trim())
      .filter((s) => s && norm(s) && haystack.includes(norm(s)));
    const unique = items.filter((s, i) => items.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i);
    if (label && unique.length) groups.push({ label, value: unique.join(", ") });
  }
  return groups.length ? groups : fallback;
}

export function candidateCorpus(profile: CandidateProfile, projectBank: ProjectBankItem[]): string {
  return [
    ...profile.experience.flatMap((x) => [x.title, ...x.bullets]),
    ...profile.extras.flatMap((x) => [x.title, x.summary ?? ""]),
    ...projectBank.flatMap((p) => [p.oneLiner, p.problem, p.approach, p.outcome, ...p.techStack]),
  ].join("\n");
}

// Pure: merges the model's edits onto the master. Anything missing or
// malformed falls back to the master's own wording, never to nothing.
export function applyTailoring(
  master: ResumeDocument,
  out: TailoringOutput,
  corpus: string
): ResumeDocument {
  const summary = str(out.summary);

  const experience = master.experience.map((x, i) => {
    const match = list(out.experience).find(
      (e) => e && typeof e === "object" && (e as Record<string, unknown>).index === i
    ) as Record<string, unknown> | undefined;
    return { ...x, bullets: rewriteBullets(x.bullets, match?.bullets) };
  });

  // Ranked order from the model, then whatever it left out in master order.
  const bySlug = new Map(master.projects.map((p) => [p.slug, p]));
  const ranked: ResumeDocument["projects"] = [];
  for (const entry of list(out.projects)) {
    if (!entry || typeof entry !== "object") continue;
    const slug = (entry as Record<string, unknown>).slug;
    const p = typeof slug === "string" ? bySlug.get(slug) : undefined;
    if (!p) continue;
    bySlug.delete(p.slug);
    ranked.push({ ...p, bullets: rewriteBullets(p.bullets, (entry as Record<string, unknown>).bullets) });
  }
  ranked.push(...bySlug.values());

  return {
    ...master,
    summary: summary && words(summary) <= MAX_SUMMARY_WORDS ? summary : master.summary,
    experience,
    skills: filterSkills(out.skills, corpus, master.skills),
    projects: ranked,
  };
}

export async function tailorResume(ctx: PersonalizeContext, input: PersonalizeInput): Promise<ResumeDocument> {
  const { profile, projectBank, llmCfg, system } = ctx;
  const master = masterResume(profile, projectBank);

  const source = {
    experience: master.experience.map((x, index) => ({
      index,
      company: x.company,
      title: x.title,
      bullets: x.bullets,
    })),
    projects: master.projects.map((p) => {
      const bank = projectBank.find((b) => b.slug === p.slug);
      return { slug: p.slug, title: p.title, techStack: bank?.techStack ?? [], outcome: bank?.outcome ?? "", bullets: p.bullets };
    }),
    education: master.education,
    extras: profile.extras,
    technologies: defaultSkills(projectBank)[0]?.value ?? "",
  };

  const userPrompt = `# CANDIDATE'S MASTER RESUME
${JSON.stringify(source, null, 2)}

# TARGET JOB
Company: ${input.company}
Role: ${input.role}
Job Description:
"""
${input.jobDescription}
"""

# TASK
Tailor the master resume to this job by editing its WORDS. The layout is fixed and sized for the
master's text, so lengths must stay put.

1) projects: return EVERY project slug exactly once, ordered most relevant to this job first.
   For each, return the SAME number of bullets in the SAME order as the master. Rewrite each bullet
   to use the job description's vocabulary where the facts genuinely support it, leading with the
   aspect this employer cares about. Keep each bullet within about 10% of its original word count.
   Keep every fact, number and technology from the original bullet; add none.
2) experience: for each entry (by index), the same rules: same bullet count and order, same facts,
   about the same length, JD vocabulary.
3) summary: 1-2 sentences, at most 45 words, aimed at this role and backed by the proof points
   above. Plain language, no buzzwords, no first-person "I am a passionate...".
4) skills: 4-6 labelled groups (e.g. "Languages", "Backend", "AI/ML", "Cloud & DevOps"), JD-relevant
   groups and items first. Use ONLY technologies that appear in the master resume above; never add
   one because the job asks for it.

# OUTPUT FORMAT (strict JSON)
{
  "summary": "string",
  "skills": [{ "label": "string", "items": ["string"] }],
  "experience": [{ "index": 0, "bullets": ["string"] }],
  "projects": [{ "slug": "string", "bullets": ["string"] }]
}`;

  const parsed = await chatJson<TailoringOutput>({
    ...llmCfg,
    system,
    user: userPrompt,
    maxTokens: 8192,
    temperature: 0.3,
  });

  return applyTailoring(master, parsed ?? {}, candidateCorpus(profile, projectBank));
}
