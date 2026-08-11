export type AtsProvider = "greenhouse" | "lever" | "ashby" | "workday" | "generic";
export type PreparationFieldStatus = "filled" | "needs_review" | "skipped";

export interface PreparationFieldReport {
  id: string;
  label: string;
  canonicalField?: string;
  status: PreparationFieldStatus;
  confidence?: "high" | "medium" | "low";
  reason?: string;
  sensitivity?: string;
  required: boolean;
}

export interface ApplicationPreparationReport {
  version: 1;
  pageUrl?: string;
  pageTitle?: string;
  atsProvider: AtsProvider;
  fields: PreparationFieldReport[];
  filledCount: number;
  reviewCount: number;
  skippedCount: number;
  resumeAttached: boolean;
  coverLetterAttached: boolean;
  capturedAt: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : undefined;
}

function safePageUrl(value: unknown): string | undefined {
  const raw = shortText(value, 2000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function detectAtsProvider(value: unknown): AtsProvider {
  const url = safePageUrl(value)?.toLowerCase() ?? "";
  if (/greenhouse\.io|greenhouse\.com/.test(url)) return "greenhouse";
  if (/lever\.co/.test(url)) return "lever";
  if (/ashbyhq\.com/.test(url)) return "ashby";
  if (/myworkdayjobs\.com|workday\.com/.test(url)) return "workday";
  return "generic";
}

function sanitizeFields(value: unknown): PreparationFieldReport[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const fields: PreparationFieldReport[] = [];
  for (const item of value.slice(0, 100)) {
    const source = record(item);
    const id = shortText(source.id, 160);
    if (!id || seen.has(id)) continue;
    const status = source.status;
    if (status !== "filled" && status !== "needs_review" && status !== "skipped") continue;
    seen.add(id);
    const confidence = source.confidence;
    fields.push({
      id,
      label: shortText(source.label, 240) ?? "Unlabelled field",
      ...(shortText(source.canonicalField, 80) ? { canonicalField: shortText(source.canonicalField, 80) } : {}),
      status,
      ...(confidence === "high" || confidence === "medium" || confidence === "low" ? { confidence } : {}),
      ...(shortText(source.reason, 400) ? { reason: shortText(source.reason, 400) } : {}),
      ...(shortText(source.sensitivity, 80) ? { sensitivity: shortText(source.sensitivity, 80) } : {}),
      required: source.required !== false,
    });
  }
  return fields;
}

export function normalizePreparationReport(
  input: unknown,
  previous?: unknown,
  now = new Date()
): ApplicationPreparationReport {
  const source = record(input);
  const old = record(previous);
  const pageUrl = safePageUrl(source.pageUrl) ?? safePageUrl(old.pageUrl);
  const requestedProvider = shortText(source.atsProvider, 30);
  const atsProvider: AtsProvider = ["greenhouse", "lever", "ashby", "workday", "generic"].includes(
    requestedProvider ?? ""
  )
    ? (requestedProvider as AtsProvider)
    : detectAtsProvider(pageUrl);
  const fields = sanitizeFields(source.fields) ?? sanitizeFields(old.fields) ?? [];

  return {
    version: 1,
    ...(pageUrl ? { pageUrl } : {}),
    ...(shortText(source.pageTitle, 200) ?? shortText(old.pageTitle, 200)
      ? { pageTitle: shortText(source.pageTitle, 200) ?? shortText(old.pageTitle, 200) }
      : {}),
    atsProvider,
    fields,
    filledCount: fields.filter((field) => field.status === "filled").length,
    reviewCount: fields.filter((field) => field.status === "needs_review").length,
    skippedCount: fields.filter((field) => field.status === "skipped").length,
    resumeAttached:
      typeof source.resumeAttached === "boolean" ? source.resumeAttached : old.resumeAttached === true,
    coverLetterAttached:
      typeof source.coverLetterAttached === "boolean" ? source.coverLetterAttached : old.coverLetterAttached === true,
    capturedAt: now.toISOString(),
  };
}

export function parsePreparationReport(value: unknown): ApplicationPreparationReport | null {
  const source = record(value);
  if (source.version !== 1) return null;
  const parsedDate = new Date(String(source.capturedAt ?? Date.now()));
  return normalizePreparationReport(
    source,
    undefined,
    Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
  );
}
