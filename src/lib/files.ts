import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { StoredFile } from "@prisma/client";
import { prisma } from "./db";

// All generated artifacts (resume PDF/tex, cover letter, the uploaded
// generic resume) live in a private Supabase Storage bucket; the StoredFile
// table holds the metadata + bucket path. This module is the only place
// that talks to the bucket — swap the vendor here if it ever changes.

export type FileKind = "resume_pdf" | "resume_tex" | "cover_letter_pdf" | "generic_resume";

const EXT: Record<FileKind, string> = {
  resume_pdf: "pdf",
  resume_tex: "tex",
  cover_letter_pdf: "pdf",
  generic_resume: "pdf",
};

const MIME: Record<FileKind, string> = {
  resume_pdf: "application/pdf",
  resume_tex: "text/x-tex",
  cover_letter_pdf: "application/pdf",
  generic_resume: "application/pdf",
};

const globalForSupabase = globalThis as unknown as { __supabase?: SupabaseClient };

function supabase(): SupabaseClient {
  if (globalForSupabase.__supabase) return globalForSupabase.__supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in .env.");
  }
  globalForSupabase.__supabase = createClient(url, key, { auth: { persistSession: false } });
  return globalForSupabase.__supabase;
}

function bucket(): string {
  return process.env.SUPABASE_BUCKET ?? "yoloapply-files";
}

function pathFor(userId: string, applicationId: string | null, kind: FileKind): string {
  return applicationId
    ? `${userId}/applications/${applicationId}/${kind}.${EXT[kind]}`
    : `${userId}/${kind}.${EXT[kind]}`;
}

export async function saveFile(
  userId: string,
  applicationId: string | null,
  kind: FileKind,
  filename: string,
  data: Buffer
): Promise<StoredFile> {
  const bucketPath = pathFor(userId, applicationId, kind);
  const { error } = await supabase()
    .storage.from(bucket())
    .upload(bucketPath, data, { contentType: MIME[kind], upsert: true });
  if (error) throw new Error(`Storage upload failed (${bucketPath}): ${error.message}`);

  // The [applicationId, kind] unique doesn't bind NULL applicationIds in
  // Postgres, so replace-by-delete covers the generic_resume case too.
  await prisma.storedFile.deleteMany({ where: { userId, applicationId, kind } });
  return prisma.storedFile.create({
    data: {
      userId,
      applicationId,
      kind,
      filename,
      mimeType: MIME[kind],
      size: data.length,
      bucketPath,
    },
  });
}

export async function getFileMeta(
  userId: string,
  applicationId: string | null,
  kind: FileKind
): Promise<StoredFile | null> {
  return prisma.storedFile.findFirst({ where: { userId, applicationId, kind } });
}

export async function fileExists(
  userId: string,
  applicationId: string | null,
  kind: FileKind
): Promise<boolean> {
  const row = await prisma.storedFile.findFirst({
    where: { userId, applicationId, kind },
    select: { id: true },
  });
  return !!row;
}

export async function getFile(
  userId: string,
  applicationId: string | null,
  kind: FileKind
): Promise<{ meta: StoredFile; data: Buffer } | null> {
  const meta = await getFileMeta(userId, applicationId, kind);
  if (!meta) return null;
  const { data, error } = await supabase().storage.from(bucket()).download(meta.bucketPath);
  if (error || !data) {
    throw new Error(`Storage download failed (${meta.bucketPath}): ${error?.message ?? "no data"}`);
  }
  return { meta, data: Buffer.from(await data.arrayBuffer()) };
}

export async function deleteFile(
  userId: string,
  applicationId: string | null,
  kind: FileKind
): Promise<void> {
  const meta = await getFileMeta(userId, applicationId, kind);
  if (!meta) return;
  await supabase().storage.from(bucket()).remove([meta.bucketPath]);
  await prisma.storedFile.delete({ where: { id: meta.id } });
}

// ── Generic resume convenience wrappers (replace src/lib/genericResume.ts) ──

export interface GenericResumeInfo {
  exists: boolean;
  filename?: string;
  size?: number;
  uploadedAt?: string;
}

export async function getGenericResumeInfo(userId: string): Promise<GenericResumeInfo> {
  const meta = await getFileMeta(userId, null, "generic_resume");
  if (!meta) return { exists: false };
  return {
    exists: true,
    filename: meta.filename,
    size: meta.size,
    uploadedAt: meta.updatedAt.toISOString(),
  };
}

export async function saveGenericResume(
  userId: string,
  buf: Buffer,
  filename: string
): Promise<GenericResumeInfo> {
  if (buf.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("File doesn't look like a PDF (missing %PDF header).");
  }
  if (buf.length > 10 * 1024 * 1024) {
    throw new Error("Resume PDF is larger than 10 MB.");
  }
  await saveFile(userId, null, "generic_resume", filename, buf);
  return getGenericResumeInfo(userId);
}

export async function deleteGenericResume(userId: string): Promise<void> {
  await deleteFile(userId, null, "generic_resume");
}

export async function readGenericResume(userId: string): Promise<Buffer | null> {
  const file = await getFile(userId, null, "generic_resume");
  return file?.data ?? null;
}
