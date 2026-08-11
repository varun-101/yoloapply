import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { extractFromText, extractFromUrl } from "../extractJob";
import { getLlmConfig } from "../credentials";
import { canonicalizeJobUrl } from "../jobs/url";
import { initializeApplicationWorkflow, recordApplicationEvent } from "./workflow";

export interface IngestJobInput {
  url?: string;
  jdUrl?: string;
  applyUrl?: string;
  source?: string;
  company?: string;
  title?: string;
  role?: string;
  location?: string;
  description?: string;
  jdText?: string;
  rawDescription?: string;
  notes?: string;
}

export async function ingestJob(userId: string, input: IngestJobInput) {
  const sourceUrl = input.url?.trim() || input.applyUrl?.trim() || input.jdUrl?.trim() || undefined;
  const canonicalUrl = canonicalizeJobUrl(sourceUrl);
  if (canonicalUrl) {
    const existing = await prisma.application.findUnique({
      where: { userId_canonicalUrl: { userId, canonicalUrl } },
    });
    if (existing) return { application: existing, deduplicated: true };
  }

  const rawDescription = input.rawDescription ?? input.description ?? input.jdText ?? "";
  let company = input.company?.trim() ?? "";
  let role = (input.role ?? input.title)?.trim() ?? "";
  let location = input.location?.trim() ?? "";
  let normalizedDescription = input.jdText?.trim() ?? input.description?.trim() ?? "";
  let applyUrl = input.applyUrl?.trim() || sourceUrl || "";
  let source = input.source?.trim() || (sourceUrl?.includes("linkedin.com") ? "linkedin" : "portal");

  if (!company || !role || normalizedDescription.length < 50) {
    const llm = await getLlmConfig(userId);
    const extracted = rawDescription.trim().length >= 200
      ? await extractFromText(llm, rawDescription, sourceUrl)
      : sourceUrl
        ? await extractFromUrl(llm, sourceUrl)
        : null;
    if (extracted) {
      company ||= extracted.company;
      role ||= extracted.role;
      location ||= extracted.location ?? "";
      normalizedDescription ||= extracted.jdText;
      applyUrl ||= extracted.applyUrl ?? "";
      source = input.source?.trim() || extracted.source || source;
    }
  }
  if (!company || !role) throw new Error("Could not determine the job company and role.");

  try {
    const application = await prisma.application.create({
      data: {
        userId,
        company,
        role,
        source,
        jdUrl: sourceUrl ?? null,
        canonicalUrl: canonicalUrl ?? null,
        rawJdText: rawDescription || null,
        jdText: normalizedDescription || null,
        applyUrl: applyUrl || null,
        location: location || null,
        notes: input.notes?.trim() || null,
        status: "draft",
      },
    });
    await initializeApplicationWorkflow(application.id, {
      hasJobDescription: normalizedDescription.length >= 50,
    });
    await recordApplicationEvent(application.id, "JOB_IMPORTED", `Imported from ${source}`, {
      source,
      sourceUrl: sourceUrl ?? null,
      canonicalUrl: canonicalUrl ?? null,
    });
    return { application, deduplicated: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && canonicalUrl) {
      const application = await prisma.application.findUniqueOrThrow({
        where: { userId_canonicalUrl: { userId, canonicalUrl } },
      });
      return { application, deduplicated: true };
    }
    throw error;
  }
}
