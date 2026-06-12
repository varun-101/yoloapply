import { chatJson } from "../llm";
import { getProfileOrNull, CandidateProfile } from "../profile";
import { getProjectBank, ProjectBankItem } from "../projectBank";
import { getDeepseekKeyOrNull } from "../credentials";
import { prisma } from "../db";

// LLM fit-scoring for freshly ingested leads, per user with the user's own
// DeepSeek key. Score is a secondary signal — the queue stays sorted by
// trust tier + recency; the badge just helps the eye.

const BATCH_SIZE = 10;
const MAX_PER_RUN = 45;
const MAX_AGE_DAYS = 14;

function profileSummary(profile: CandidateProfile, projects: ProjectBankItem[]): string {
  const projectLines = projects.map((p) => `- ${p.title}: ${p.oneLiner}`).join("\n");
  const exp = profile.experience
    .map((e) => `- ${e.title} @ ${e.company} (${e.period}): ${e.bullets.join(" ")}`)
    .join("\n");
  const edu = profile.education
    ? `${profile.education.degree}, ${profile.education.school}${profile.education.grad ? `, graduating ${profile.education.grad}` : ""}`
    : "n/a";
  return `Name: ${profile.name}
Location: ${[profile.city, profile.country].filter(Boolean).join(", ") || "n/a"}
Education: ${edu}
Experience (~${profile.yearsOfExperience || "0"} yr):
${exp || "- none yet"}
Projects:
${projectLines || "- none listed"}`;
}

// One-line persona for the system prompt, templated from the profile.
function personaLine(profile: CandidateProfile): string {
  const place = [profile.city, profile.country].filter(Boolean).join(", ");
  const yoe = profile.yearsOfExperience || "0";
  const grad = profile.education?.grad ? `graduating ${profile.education.grad}` : "";
  return `a candidate${place ? ` based in ${place}` : ""} with ~${yoe} yr of experience${grad ? `, ${grad}` : ""}, looking for early-career software engineering roles in their region or remote`;
}

function systemPrompt(profile: CandidateProfile): string {
  return `You score job postings for fit against a specific candidate: ${personaLine(profile)}. The full candidate profile is provided with each request.

For each posting, return a fit score 0-100 and a ONE-line reason (max 12 words, no quotation marks).
Scoring guide:
- 80-100: junior/early-career role matching the candidate's stack, in their region or remote
- 60-79: relevant engineering role, partial stack match or unstated seniority
- 40-59: software role but wrong specialty or seniority unclear
- 0-39: wrong seniority (3+ yrs required), wrong field, or a location they can't work from

Output STRICT JSON: {"scores": [{"id": "...", "score": 0, "reason": "..."}]} — one entry per posting, same ids.`;
}

interface LeadForScoring {
  id: string;
  company: string;
  role: string;
  location: string | null;
  experience: string | null;
  salary: string | null;
  skills: string | null;
  jdText: string | null;
}

async function scoreBatch(
  apiKey: string,
  system: string,
  summary: string,
  leads: LeadForScoring[]
): Promise<number> {
  const list = leads
    .map((l) => {
      const parts = [
        `id: ${l.id}`,
        `role: ${l.role} @ ${l.company}`,
        l.location ? `location: ${l.location}` : null,
        l.experience ? `experience required: ${l.experience}` : null,
        l.salary ? `salary: ${l.salary}` : null,
        l.skills ? `skills: ${l.skills}` : null,
        l.jdText ? `jd excerpt: ${l.jdText.slice(0, 350).replace(/\s+/g, " ")}` : null,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n---\n");

  const out = await chatJson<{ scores: { id: string; score: number; reason: string }[] }>({
    apiKey,
    system,
    user: `# CANDIDATE\n${summary}\n\n# POSTINGS\n${list}\n\n# TASK\nScore every posting.`,
    temperature: 0.2,
    maxTokens: 4096,
  });

  let updated = 0;
  const valid = new Set(leads.map((l) => l.id));
  for (const s of out.scores ?? []) {
    if (!valid.has(s.id) || typeof s.score !== "number") continue;
    await prisma.jobLead.update({
      where: { id: s.id },
      data: {
        score: Math.max(0, Math.min(100, Math.round(s.score))),
        scoreReason: String(s.reason ?? "").slice(0, 200),
      },
    });
    updated++;
  }
  return updated;
}

// Scores the user's unscored new leads, freshest first, capped per run to
// bound cost. Skips gracefully when the user has no key or no profile.
export async function scoreNewLeads(userId: string): Promise<{ scored: number; error?: string }> {
  const apiKey = await getDeepseekKeyOrNull(userId);
  if (!apiKey) {
    return { scored: 0, error: "no DeepSeek key configured — skipped scoring" };
  }
  const profile = await getProfileOrNull(userId);
  if (!profile) {
    return { scored: 0, error: "no profile configured — skipped scoring" };
  }
  const projects = await getProjectBank(userId);

  const since = new Date(Date.now() - MAX_AGE_DAYS * 86400 * 1000);
  const leads = await prisma.jobLead.findMany({
    where: {
      userId,
      status: "new",
      score: null,
      OR: [{ postedAt: { gte: since } }, { postedAt: null, createdAt: { gte: since } }],
    },
    select: {
      id: true,
      company: true,
      role: true,
      location: true,
      experience: true,
      salary: true,
      skills: true,
      jdText: true,
    },
    orderBy: [{ postedAt: "desc" }],
    take: MAX_PER_RUN,
  });
  if (leads.length === 0) return { scored: 0 };

  const system = systemPrompt(profile);
  const summary = profileSummary(profile, projects);

  let scored = 0;
  let error: string | undefined;
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    try {
      scored += await scoreBatch(apiKey, system, summary, leads.slice(i, i + BATCH_SIZE));
    } catch (e: unknown) {
      // One malformed LLM response shouldn't sink the other batches — those
      // leads stay unscored and get retried on the next scan.
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { scored, error };
}
