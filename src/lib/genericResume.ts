import { existsSync, statSync } from "fs";
import { writeFile, mkdir, unlink, readFile } from "fs/promises";
import path from "path";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

export function genericResumePath(): string {
  return path.resolve(STORAGE_DIR, "generic-resume.pdf");
}

export interface GenericResumeInfo {
  exists: boolean;
  path: string;
  size?: number;
  uploadedAt?: string;
}

export function getGenericResumeInfo(): GenericResumeInfo {
  const p = genericResumePath();
  if (!existsSync(p)) return { exists: false, path: p };
  const s = statSync(p);
  return { exists: true, path: p, size: s.size, uploadedAt: s.mtime.toISOString() };
}

export async function saveGenericResume(buf: Buffer): Promise<GenericResumeInfo> {
  if (buf.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("File doesn't look like a PDF (missing %PDF header).");
  }
  if (buf.length > 10 * 1024 * 1024) {
    throw new Error("Resume PDF is larger than 10 MB.");
  }
  const p = genericResumePath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, buf);
  return getGenericResumeInfo();
}

export async function deleteGenericResume(): Promise<void> {
  const p = genericResumePath();
  if (existsSync(p)) await unlink(p);
}

export async function readGenericResume(): Promise<Buffer | null> {
  const p = genericResumePath();
  if (!existsSync(p)) return null;
  return await readFile(p);
}
