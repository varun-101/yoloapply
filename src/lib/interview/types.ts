// Shared types for the interview coach. The "hidden" assessment never reaches
// the live UI — it drives the next move and the final report only.

export type Persona = "neutral" | "friendly" | "stress";
export type RoundType = "behavioral" | "technical" | "mixed";
export type InterviewMode = "company" | "general";

// Why a thread advances the way it does. SEED opens a topic; DRILL/CHALLENGE
// deepen it; PIVOT keeps the topic but changes angle; MOVE_ON ends the thread.
export type Move = "SEED" | "DRILL" | "CHALLENGE" | "PIVOT" | "MOVE_ON";

export interface Topic {
  title: string; // short label, e.g. "Funding Radar architecture"
  kind: "project" | "behavioral" | "technical" | "role";
  seed: string; // the opening question for this topic
}

// Per-turn rubric, 0-5 each. Hidden from the candidate during the session.
export interface Assessment {
  relevance: number;
  specificity: number;
  correctness: number;
  communication: number;
  note: string; // one-line coaching note (used in the report, not shown live)
}

export interface AdvanceResult {
  assessment: Assessment; // grades the answer that was just submitted
  move: Move; // what the interviewer decided to do next
  interviewerLine: string; // the next thing the interviewer says (shown + spoken)
}

export interface ReportTopic {
  title: string;
  score: number; // 0-100
  summary: string;
}

export interface InterviewReport {
  overall: number; // 0-100
  dimensions: {
    relevance: number;
    specificity: number;
    correctness: number;
    communication: number;
  };
  strengths: string[];
  gaps: string[];
  actions: string[]; // concrete prep actions
  perTopic: ReportTopic[];
}

// What the client renders. Mirrors the InterviewTurn row minus the hidden field.
export interface PublicTurn {
  id: string;
  index: number;
  topicIndex: number;
  move: string;
  question: string;
  answer: string | null;
}

export interface PublicSession {
  id: string;
  mode: string;
  persona: string;
  roundType: string;
  status: string;
  company: string | null;
  role: string | null;
  currentTopic: number;
  topicCount: number;
  timeLimitMin: number | null; // null = untimed
  startedAt: string; // ISO — UI ticks a timer from this
  report: InterviewReport | null;
  turns: PublicTurn[];
}
