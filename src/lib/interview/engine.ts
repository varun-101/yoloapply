import { chatJson, deAi } from "../llm";
import { InterviewContext, candidateForPrompt } from "./context";
import {
  AdvanceResult,
  Assessment,
  InterviewReport,
  Move,
  Persona,
  RoundType,
  Topic,
} from "./types";

// The interviewer NEVER invents facts about the candidate — same guardrail as
// personalize.ts. It may probe, doubt, and ask for specifics, but every premise
// must trace to the supplied profile/project bank/JD.
const GROUNDING = `You may only reference facts present in the supplied candidate profile, project bank, and job description. Never invent employers, projects, metrics, or technologies the candidate did not list. You MAY ask about things not present (that is how you probe), but never assert them as fact.`;

const PERSONA_STYLE: Record<Persona, string> = {
  neutral:
    "a fair, professional senior engineer at a strong tech company. You are warm but rigorous: you ask 'why' a lot and want concrete specifics.",
  friendly:
    "an encouraging interviewer. You build the candidate up, but still dig for detail and gently push when an answer is thin.",
  stress:
    "a skeptical, demanding interviewer. You push back hard, surface contradictions, and are hard to satisfy, while staying professional (never rude).",
};

const ROUND_FOCUS: Record<RoundType, string> = {
  behavioral: "Focus on behavioral/experience topics: ownership, conflict, failure, impact.",
  technical: "Focus on technical depth: design choices, trade-offs, how things work under the hood.",
  mixed: "Mix behavioral and technical topics.",
};

function jobBlock(ctx: InterviewContext): string {
  if (ctx.mode !== "company") {
    return "# TARGET\nGeneral interview based on the candidate's own resume (no specific job).";
  }
  return `# TARGET JOB
Company: ${ctx.company}
Role: ${ctx.role}
Job Description:
"""
${ctx.jobDescription ?? "(no JD text available — infer a realistic round from the role title)"}
"""`;
}

// ── 1. Plan the topics (once, at session start) ─────────────────────────────

// Roughly how many topics fill a given minute budget (each topic is a few
// turns of cross-questioning). Untimed → a standard 4.
export function topicCountFor(timeLimitMin: number | null | undefined): number {
  if (!timeLimitMin) return 4;
  return Math.max(3, Math.min(8, Math.round(timeLimitMin / 2.5)));
}

export async function planTopics(
  ctx: InterviewContext,
  persona: Persona,
  roundType: RoundType,
  timeLimitMin: number | null
): Promise<Topic[]> {
  const want = topicCountFor(timeLimitMin);
  const system = `You are an expert interviewer designing a realistic mock interview. ${GROUNDING}
Output STRICT JSON only.`;

  const user = `# CANDIDATE
${JSON.stringify(candidateForPrompt(ctx), null, 2)}

${jobBlock(ctx)}

# TASK
Plan ${want} interview topics for a realistic round. ${ROUND_FOCUS[roundType]}
- Prefer topics anchored to the candidate's REAL projects and experience.
- For a company interview, bias toward what THIS job description cares about.
- Each topic gets ONE natural opening question (conversational, not a quiz prompt).
- Order them like a real interview: an easy warm-up first, harder ones later.

# OUTPUT (strict JSON)
{
  "topics": [
    { "title": "short label", "kind": "project" | "behavioral" | "technical" | "role", "seed": "the opening question" }
  ]
}`;

  const out = await chatJson<{ topics: Topic[] }>({
    ...ctx.llmCfg,
    system,
    user,
    temperature: 0.6,
    maxTokens: 2048,
  });
  const topics = Array.isArray(out.topics) ? out.topics.slice(0, want) : [];
  for (const t of topics) t.seed = deAi(t.seed);
  return topics.length
    ? topics
    : [{ title: "Background", kind: "behavioral", seed: deAi("Tell me about a project you're proud of and your specific role on it.") }];
}

// ── 2. Advance the conversation: grade the answer + decide the next move ─────
// One combined call (interviewer + examiner). The assessment is stored hidden;
// the line is what the candidate hears next. The move tells the caller whether
// to deepen the current topic or advance to the next one.

interface ThreadTurn {
  question: string;
  answer: string;
  move: string;
}

export async function advanceTurn(args: {
  ctx: InterviewContext;
  persona: Persona;
  topics: Topic[];
  topicIndex: number;
  depth: number; // how many turns deep into the current topic already
  thread: ThreadTurn[]; // prior Q&A within the CURRENT topic, in order
  lastQuestion: string;
  lastAnswer: string;
  // Time-budget signal: "soon" = approaching the limit, wind down; "now" = out
  // of time, give a closing remark (the caller then finalizes the session).
  wrap?: "none" | "soon" | "now";
}): Promise<AdvanceResult> {
  const { ctx, persona, topics, topicIndex, depth, thread, lastQuestion, lastAnswer } = args;
  const wrap = args.wrap ?? "none";
  const topic = topics[topicIndex];
  const isLastTopic = topicIndex >= topics.length - 1;
  const DEPTH_CAP = 4;
  const nearCap = depth >= DEPTH_CAP || wrap === "soon";

  const system = `You are ${PERSONA_STYLE[persona]}
You are running a live, voice mock interview — speak in first person, conversational, ONE short turn at a time (1-3 sentences). Never narrate or break character. ${GROUNDING}

You also silently grade the candidate's LAST answer on a 0-5 scale per dimension. This grade is hidden from the candidate; use it to decide your next move:
- DRILL: go deeper on something specific they just said (your default while the thread has substance).
- CHALLENGE: push back on a vague, hand-wavy, or "we did X" (not "I did X") answer; ask them to get concrete.
- PIVOT: same topic, fresh angle, when drilling is exhausted but the topic isn't.
- MOVE_ON: the thread is mined out, the answer was strong and complete, the candidate is clearly stuck, or you've gone deep enough.

Output STRICT JSON only.`;

  const timeNote =
    wrap === "now"
      ? "TIME IS UP. Do NOT ask another question — set move to MOVE_ON and make interviewerLine a brief, warm CLOSING remark that ends the interview."
      : wrap === "soon"
      ? "The interview is almost out of time. Wind down: keep this brief and steer toward closing within a turn or two; prefer MOVE_ON over starting new threads."
      : "";

  const guidance = [
    `Current topic (${topicIndex + 1}/${topics.length}): "${topic?.title ?? ""}". You are ${depth} turns deep.`,
    nearCap
      ? "You have drilled this topic enough — strongly prefer MOVE_ON unless the last answer opened something genuinely important."
      : "Prefer DRILL/CHALLENGE while the topic still has depth.",
    isLastTopic
      ? "This is the LAST topic. On MOVE_ON, you are signalling the interview should wrap — keep your line a brief closing remark."
      : "On MOVE_ON, give a brief transition then open the NEXT topic with its seed (you'll be told it below).",
    timeNote,
  ]
    .filter(Boolean)
    .join(" ");

  const nextSeed = !isLastTopic ? topics[topicIndex + 1]?.seed ?? "" : "";

  const user = `# CANDIDATE (for grounding only — do not invent beyond this)
${JSON.stringify(candidateForPrompt(ctx), null, 2)}

${jobBlock(ctx)}

# CURRENT TOPIC THREAD (most recent last)
${thread.length ? JSON.stringify(thread, null, 2) : "(this is the first answer in the topic)"}

# THE QUESTION YOU JUST ASKED
${lastQuestion}

# THE CANDIDATE'S ANSWER
"""
${lastAnswer}
"""

# DECISION GUIDANCE
${guidance}
${nextSeed ? `Next topic seed (use/adapt this if you MOVE_ON): "${nextSeed}"` : ""}

# OUTPUT (strict JSON)
{
  "assessment": { "relevance": 0-5, "specificity": 0-5, "correctness": 0-5, "communication": 0-5, "note": "one-line coaching note" },
  "move": "DRILL" | "CHALLENGE" | "PIVOT" | "MOVE_ON",
  "interviewerLine": "what you say next, in character, 1-3 sentences"
}`;

  const out = await chatJson<{
    assessment: Assessment;
    move: Move;
    interviewerLine: string;
  }>({
    ...ctx.llmCfg,
    system,
    user,
    temperature: 0.6,
    maxTokens: 1200,
  });

  return {
    assessment: clampAssessment(out.assessment),
    move: normalizeMove(out.move, nearCap || isLastTopic),
    interviewerLine: deAi(out.interviewerLine || "Okay, let's continue."),
  };
}

// ── 3. Final report ─────────────────────────────────────────────────────────

export async function buildReport(args: {
  ctx: InterviewContext;
  topics: Topic[];
  transcript: { topicIndex: number; question: string; answer: string; assessment: Assessment | null }[];
}): Promise<InterviewReport> {
  const { ctx, topics, transcript } = args;
  const system = `You are an interview coach writing a candid, useful debrief after a mock interview. Be specific and honest; quote moments from the transcript. ${GROUNDING}
Output STRICT JSON only.`;

  const user = `# TOPICS
${JSON.stringify(topics.map((t) => t.title))}

# TRANSCRIPT WITH HIDDEN PER-ANSWER GRADES
${JSON.stringify(transcript, null, 2)}

# TASK
Write the debrief. Scores are 0-100. Strengths/gaps/actions are concrete and reference what actually happened (you may quote the candidate). Actions are things to practice before the real interview.

# OUTPUT (strict JSON)
{
  "overall": 0-100,
  "dimensions": { "relevance": 0-100, "specificity": 0-100, "correctness": 0-100, "communication": 0-100 },
  "strengths": ["..."],
  "gaps": ["..."],
  "actions": ["..."],
  "perTopic": [ { "title": "...", "score": 0-100, "summary": "..." } ]
}`;

  const out = await chatJson<InterviewReport>({
    ...ctx.llmCfg,
    system,
    user,
    temperature: 0.4,
    maxTokens: 2048,
  });
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function clampAssessment(a: Assessment | undefined): Assessment {
  const c = (n: unknown) => Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return {
    relevance: c(a?.relevance),
    specificity: c(a?.specificity),
    correctness: c(a?.correctness),
    communication: c(a?.communication),
    note: deAi(a?.note ?? ""),
  };
}

function normalizeMove(move: Move | string | undefined, forceMoveOn: boolean): Move {
  const valid: Move[] = ["DRILL", "CHALLENGE", "PIVOT", "MOVE_ON"];
  const m = valid.includes(move as Move) ? (move as Move) : "DRILL";
  // Safety net: if we're at/over the depth cap or on the last topic, never let
  // the model loop forever — honor MOVE_ON intent.
  if (forceMoveOn && m === "DRILL") return "PIVOT";
  return m;
}
