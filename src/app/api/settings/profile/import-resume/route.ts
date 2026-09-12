import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { requireUser, apiError, ApiUserError } from "@/lib/auth";
import { getLlmConfig } from "@/lib/credentials";
import { extractProfileFromResumeText } from "@/lib/resumeImport";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 10;
const MIN_TEXT_LENGTH = 80;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const value = form.get("file");
    if (!value || typeof value === "string") {
      throw new ApiUserError("Choose a resume PDF to import.", 400, "missing_resume");
    }

    const file = value as File;
    if (file.type && file.type !== "application/pdf") {
      throw new ApiUserError("Resume import currently supports PDF files only.", 400, "invalid_resume_type");
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ApiUserError("Resume PDF must be 10 MB or smaller.", 400, "resume_too_large");
    }

    const data = new Uint8Array(await file.arrayBuffer());
    if (Buffer.from(data.subarray(0, 4)).toString() !== "%PDF") {
      throw new ApiUserError("The selected file does not look like a PDF.", 400, "invalid_resume");
    }

    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(data);
    } catch {
      throw new ApiUserError(
        "We could not open this PDF. It may be damaged or password protected.",
        400,
        "invalid_resume"
      );
    }

    try {
      if (pdf.numPages > MAX_PAGES) {
        throw new ApiUserError(
          `Resume import supports up to ${MAX_PAGES} pages. This PDF has ${pdf.numPages}.`,
          400,
          "resume_too_long"
        );
      }

      let extracted: { totalPages: number; text: string };
      try {
        extracted = await extractText(pdf, { mergePages: true });
      } catch {
        throw new ApiUserError(
          "We could not read this PDF. Export an unlocked, text-based PDF and try again.",
          400,
          "resume_text_unreadable"
        );
      }
      const text = extracted.text.trim();
      if (text.length < MIN_TEXT_LENGTH) {
        throw new ApiUserError(
          "We could not read enough text from this PDF. Export the resume as a text-based PDF and try again.",
          400,
          "resume_text_unreadable"
        );
      }

      const llm = await getLlmConfig(user.id);
      const profile = await extractProfileFromResumeText(text, llm);
      return NextResponse.json({ profile, pages: pdf.numPages });
    } finally {
      await pdf.loadingTask.destroy().catch(() => undefined);
    }
  } catch (error) {
    return apiError(error);
  }
}
