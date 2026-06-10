import { chatJson } from "../llm";
import { owner } from "../owner";
import { PROJECT_BANK } from "../projects";
import { prisma } from "../db";

// LLM fit-scoring for freshly ingested leads. Score is a secondary signal —
// the queue stays sorted by trust tier + recency; the badge just helps the eye.

const BATCH_SIZE = 10;
const MAX_PER_RUN = 45;
const MAX_AGE_DAYS = 14;

function profileSummary(): string {
  const projects = PROJECT_BANK.map((p) => `- ${p.title}: ${p.oneLiner}`).join("\n");
  const exp = owner.experience
    .map((e) => `- ${e.title} @ ${e.company} (${e.period}): ${e.bullets.join(" ")}`)
    .join("\n");
  return `Name: ${owner.name}
Location: ${owner.city}, ${owner.country}
Education: ${owner.education.degree}, ${owner.education.school}, graduating ${owner.education.grad}
Experience (~${owner.yearsOfExperience} yr):
${exp}
Projects:
${projects}`;
}

const SYSTEM = `You score job postings for fit against a specific candidate: a final-year computer engineering student in Mumbai with ~1 year of backend internship experience (Java, PostgreSQL, Node.js, Next.js), looking for fresher/junior software engineering roles in India or remote.

For each posting, return a fit score 0-100 and a ONE-line reason (max 12 words, no quotation marks).
Scoring guide:
- 80-100: junior/fresher backend or full-stack role matching his stack, in India/remote
- 60-79: relevant engineering role, partial stack match or unstated seniority
- 40-59: software role but wrong specialty (mobile, QA, embedded) or seniority unclear
- 0-39: wrong seniority (3+ yrs required), wrong field, or location he can't work from

Output STRICT JSON: {"scores": [{"id": "...", "score": 0, "reason": "..."}]} — one entry per posting, same ids.`;

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

async function scoreBatch(leads: LeadForScoring[]): Promise<number> {
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
    system: SYSTEM,
    user: `# CANDIDATE\n${profileSummary()}\n\n# POSTINGS\n${list}\n\n# TASK\nScore every posting.`,
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

// Scores unscored new leads, freshest first, capped per run to bound cost.
// Returns the number of leads scored; throws nothing (logs into the result).
export async function scoreNewLeads(): Promise<{ scored: number; error?: string }> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { scored: 0, error: "DEEPSEEK_API_KEY not set — skipped scoring" };
  }
  const since = new Date(Date.now() - MAX_AGE_DAYS * 86400 * 1000);
  const leads = await prisma.jobLead.findMany({
    where: {
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

  let scored = 0;
  let error: string | undefined;
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    try {
      scored += await scoreBatch(leads.slice(i, i + BATCH_SIZE));
    } catch (e: unknown) {
      // One malformed LLM response shouldn't sink the other batches — those
      // leads stay unscored and get retried on the next scan.
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { scored, error };
}
