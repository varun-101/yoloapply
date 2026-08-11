export const APPLICATION_TASK_KEYS = [
  "PARSE_JOB",
  "ANALYZE_MATCH",
  "GENERATE_RESUME",
  "FIND_RECRUITER",
  "GENERATE_OUTREACH",
  "PREPARE_APPLICATION",
  "SEND_OUTREACH",
  "FOLLOW_UP",
] as const;

export type ApplicationTaskKeyValue = (typeof APPLICATION_TASK_KEYS)[number];

export const APPLICATION_TASK_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
  "NEEDS_REVIEW",
] as const;

export type ApplicationTaskStatusValue = (typeof APPLICATION_TASK_STATUSES)[number];

export type ApplicationReadiness =
  | "NOT_STARTED"
  | "PREPARING"
  | "NEEDS_REVIEW"
  | "READY"
  | "FAILED";

export interface ApplicationTaskDefinition {
  key: ApplicationTaskKeyValue;
  label: string;
  required: boolean;
  sortOrder: number;
}

// ATS preparation, sending, and follow-up are opt-in actions. They become
// required for their own sub-flow when the user starts them; they do not block
// the core "job + analysis + resume + recruiter + outreach draft" readiness.
export const APPLICATION_TASK_DEFINITIONS: readonly ApplicationTaskDefinition[] = [
  { key: "PARSE_JOB", label: "Job parsed", required: true, sortOrder: 10 },
  { key: "ANALYZE_MATCH", label: "Match analyzed", required: true, sortOrder: 20 },
  { key: "GENERATE_RESUME", label: "Resume generated", required: true, sortOrder: 30 },
  { key: "FIND_RECRUITER", label: "Recruiter selected", required: true, sortOrder: 40 },
  { key: "GENERATE_OUTREACH", label: "Outreach drafted", required: true, sortOrder: 50 },
  { key: "PREPARE_APPLICATION", label: "Application prepared", required: false, sortOrder: 60 },
  { key: "SEND_OUTREACH", label: "Outreach sent", required: false, sortOrder: 70 },
  { key: "FOLLOW_UP", label: "Follow-up", required: false, sortOrder: 80 },
] as const;

export interface TaskStateLike {
  status: ApplicationTaskStatusValue;
  required: boolean;
}

export function deriveApplicationReadiness(tasks: readonly TaskStateLike[]): ApplicationReadiness {
  const required = tasks.filter((task) => task.required);
  if (required.length === 0 || required.every((task) => task.status === "PENDING")) {
    return "NOT_STARTED";
  }
  if (required.some((task) => task.status === "FAILED")) return "FAILED";
  if (required.some((task) => task.status === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (required.every((task) => task.status === "SUCCESS" || task.status === "SKIPPED")) {
    return "READY";
  }
  return "PREPARING";
}

export function applicationTaskDefinition(key: ApplicationTaskKeyValue): ApplicationTaskDefinition {
  const definition = APPLICATION_TASK_DEFINITIONS.find((task) => task.key === key);
  if (!definition) throw new Error(`Unknown application task: ${key}`);
  return definition;
}
