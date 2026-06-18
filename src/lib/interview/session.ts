import { prisma } from "../db";
import { ApiUserError } from "../auth";
import { loadInterviewContext, InterviewContext } from "./context";
import { planTopics, advanceTurn, buildReport } from "./engine";
import {
  Assessment,
  InterviewMode,
  InterviewReport,
  Persona,
  PublicSession,
  PublicTurn,
  RoundType,
  Topic,
} from "./types";

// Hard guards so a session always terminates even if the model keeps choosing
// to drill: cap depth per topic and total turns. The engine ALSO nudges toward
// MOVE_ON near the soft cap (DEPTH_CAP=4 in engine.ts) — these are the backstop.
const HARD_DEPTH_CAP = 6;
const MAX_TURNS = 24;
const STALE_MS = 30 * 60 * 1000; // a running session untouched this long is dead

// ── Per-session in-flight lock (mirrors runUserScan in discovery/pipeline.ts).
// Lives on globalThis to survive HMR; single-instance only (see CLAUDE.md).
interface InterviewGlobal {
  __interviewAdvance?: Map<string, Promise<PublicSession>>;
}
const g = globalThis as unknown as InterviewGlobal;
function advanceLocks(): Map<string, Promise<PublicSession>> {
  return (g.__interviewAdvance ??= new Map());
}

export class AlreadyAdvancing extends Error {
  constructor() {
    super("A previous answer is still being processed.");
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  opts: {
    mode: InterviewMode;
    applicationId?: string | null;
    persona: Persona;
    roundType: RoundType;
    timeLimitMin?: number | null;
  }
): Promise<PublicSession> {
  const ctx = await loadInterviewContext(userId, opts.applicationId);
  const timeLimitMin = opts.timeLimitMin ?? null;
  const topics = await planTopics(ctx, opts.persona, opts.roundType, timeLimitMin);

  const session = await prisma.interviewSession.create({
    data: {
      userId,
      applicationId: opts.applicationId ?? null,
      mode: opts.mode,
      persona: opts.persona,
      roundType: opts.roundType,
      timeLimitMin,
      status: "running",
      topics: topics as object,
      currentTopic: 0,
      turns: {
        create: {
          index: 0,
          topicIndex: 0,
          depth: 0,
          move: "SEED",
          question: topics[0].seed,
        },
      },
    },
    include: { turns: { orderBy: { index: "asc" } }, application: true },
  });

  return toPublicSession(session, ctx);
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function getPublicSession(userId: string, sessionId: string): Promise<PublicSession> {
  const session = await fetchOwned(userId, sessionId);
  return toPublicSession(session, null);
}

// ── Submit an answer → grade + advance (lock-guarded) ───────────────────────

export async function submitAnswer(
  userId: string,
  sessionId: string,
  answer: string
): Promise<PublicSession> {
  const locks = advanceLocks();
  if (locks.has(sessionId)) throw new AlreadyAdvancing();

  const p = doAdvance(userId, sessionId, answer).finally(() => locks.delete(sessionId));
  locks.set(sessionId, p);
  return p;
}

async function doAdvance(userId: string, sessionId: string, answer: string): Promise<PublicSession> {
  const session = await fetchOwned(userId, sessionId);
  if (session.status !== "running") {
    return toPublicSession(session, null);
  }

  const turns = session.turns;
  const open = [...turns].reverse().find((t) => t.answer === null);
  if (!open) {
    // Nothing awaiting an answer — return current state rather than erroring.
    return toPublicSession(session, null);
  }

  const topics = (session.topics as unknown as Topic[]) ?? [];
  const ctx = await loadInterviewContext(userId, session.applicationId);

  // Prior Q&A within the current topic (answered turns, excluding the open one).
  const thread = turns
    .filter((t) => t.topicIndex === open.topicIndex && t.id !== open.id && t.answer !== null)
    .sort((a, b) => a.index - b.index)
    .map((t) => ({ question: t.question, answer: t.answer ?? "", move: t.move }));

  // Time budget: a target, not a hard stop. In the last quarter the interviewer
  // winds down ("soon"); once over the limit the next line is a closing remark
  // ("now") and we finalize — so it ends at a turn boundary ~around the target.
  const wrap = timeWrapState(session.timeLimitMin, session.startedAt);

  const result = await advanceTurn({
    ctx,
    persona: session.persona as Persona,
    topics,
    topicIndex: session.currentTopic,
    depth: open.depth,
    thread,
    lastQuestion: open.question,
    lastAnswer: answer,
    wrap,
  });

  // Record the answer + its hidden grade on the turn we just closed.
  await prisma.interviewTurn.update({
    where: { id: open.id },
    data: { answer, feedback: result.assessment as object },
  });

  const isLastTopic = session.currentTopic >= topics.length - 1;
  const hitDepthCap = open.depth + 1 >= HARD_DEPTH_CAP;
  const hitTurnCap = turns.length >= MAX_TURNS;
  // Leave the current topic when the model says so OR we've hit the hard depth
  // cap (the cap must hold even on the last topic — there it forces a wrap).
  const shouldAdvance = result.move === "MOVE_ON" || hitDepthCap;
  const forceWrap = wrap === "now" || hitTurnCap || (shouldAdvance && isLastTopic);
  const moveOn = shouldAdvance && !isLastTopic;

  if (forceWrap) {
    return finalize(userId, sessionId, ctx, result.interviewerLine);
  }

  const nextTopic = moveOn ? session.currentTopic + 1 : session.currentTopic;
  const nextDepth = moveOn ? 0 : open.depth + 1;

  await prisma.$transaction([
    prisma.interviewTurn.create({
      data: {
        sessionId,
        index: turns.length,
        topicIndex: nextTopic,
        depth: nextDepth,
        move: moveOn ? "MOVE_ON" : result.move,
        question: result.interviewerLine,
      },
    }),
    prisma.interviewSession.update({
      where: { id: sessionId },
      data: { currentTopic: nextTopic },
    }),
  ]);

  return getPublicSession(userId, sessionId);
}

// ── Finish (explicit "End interview", or auto on wrap) ──────────────────────

export async function finishSession(userId: string, sessionId: string): Promise<PublicSession> {
  const session = await fetchOwned(userId, sessionId);
  if (session.status === "completed") return toPublicSession(session, null);
  const ctx = await loadInterviewContext(userId, session.applicationId);
  return finalize(userId, sessionId, ctx, null);
}

async function finalize(
  userId: string,
  sessionId: string,
  ctx: InterviewContext,
  closingLine: string | null
): Promise<PublicSession> {
  const session = await fetchOwned(userId, sessionId);
  const topics = (session.topics as unknown as Topic[]) ?? [];

  const transcript = session.turns
    .filter((t) => t.answer !== null)
    .map((t) => ({
      topicIndex: t.topicIndex,
      question: t.question,
      answer: t.answer ?? "",
      assessment: (t.feedback as unknown as Assessment | null) ?? null,
    }));

  let report: InterviewReport | null = null;
  try {
    report = transcript.length ? await buildReport({ ctx, topics, transcript }) : null;
  } catch {
    report = null; // a report failure shouldn't strand the session as "running"
  }

  // If a closing line was produced (wrap on MOVE_ON), record it as a terminal
  // interviewer turn so the transcript reads naturally.
  if (closingLine) {
    await prisma.interviewTurn.create({
      data: {
        sessionId,
        index: session.turns.length,
        topicIndex: session.currentTopic,
        depth: 0,
        move: "MOVE_ON",
        question: closingLine,
      },
    });
  }

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { status: "completed", finishedAt: new Date(), report: (report as object) ?? undefined },
  });

  return getPublicSession(userId, sessionId);
}

// ── helpers ─────────────────────────────────────────────────────────────────

type SessionRow = Awaited<ReturnType<typeof fetchOwned>>;

async function fetchOwned(userId: string, sessionId: string) {
  const session = await prisma.interviewSession.findFirst({
    where: { id: sessionId, userId },
    include: { turns: { orderBy: { index: "asc" } }, application: true },
  });
  if (!session) throw new ApiUserError("Interview not found.", 404, "not_found");

  // Stale running session (process died mid-advance) → mark abandoned so the UI
  // doesn't sit forever. Mirrors SCAN_STALE_MS in discovery.
  if (
    session.status === "running" &&
    Date.now() - session.updatedAt.getTime() > STALE_MS &&
    !advanceLocks().has(sessionId)
  ) {
    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { status: "abandoned" },
    });
    session.status = "abandoned";
  }
  return session;
}

function toPublicSession(session: SessionRow, ctx: InterviewContext | null): PublicSession {
  const topics = (session.topics as unknown as Topic[]) ?? [];
  // turns already arrive ordered by index asc (fetchOwned / create include).
  const publicTurns: PublicTurn[] = session.turns.map((t) => ({
    id: t.id,
      index: t.index,
      topicIndex: t.topicIndex,
      move: t.move,
      question: t.question,
      answer: t.answer,
    }));
  return {
    id: session.id,
    mode: session.mode,
    persona: session.persona,
    roundType: session.roundType,
    status: session.status,
    company: session.application?.company ?? ctx?.company ?? null,
    role: session.application?.role ?? ctx?.role ?? null,
    currentTopic: session.currentTopic,
    topicCount: topics.length,
    timeLimitMin: session.timeLimitMin ?? null,
    startedAt: session.startedAt.toISOString(),
    report: (session.report as unknown as InterviewReport | null) ?? null,
    turns: publicTurns,
  };
}

// Where we are against the time budget. A target, not a hard cut: "soon" winds
// the interviewer down in the last quarter; "now" (over the limit) ends it at
// the next turn boundary so the interview lands ~around the requested length.
function timeWrapState(
  timeLimitMin: number | null,
  startedAt: Date
): "none" | "soon" | "now" {
  if (!timeLimitMin) return "none";
  const limitMs = timeLimitMin * 60_000;
  const elapsed = Date.now() - startedAt.getTime();
  if (elapsed >= limitMs) return "now";
  if (elapsed >= limitMs * 0.75) return "soon";
  return "none";
}
