import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import AdmZip from "adm-zip";
import { requireUser, apiError } from "@/lib/auth";

// Serves the Chrome extension as a single .zip so users can install it without
// cloning the repo: download → unzip → chrome://extensions → Load unpacked →
// pick the unzipped "yoloapply-extension" folder. The extension ships no
// secrets (the per-user token is pasted in afterwards), but we still require a
// signed-in session for consistency with the rest of /api/settings.

export const dynamic = "force-dynamic";

// The extension/ dir is static at runtime, so build the archive once and reuse.
let cachedZip: Buffer | null = null;
const EXTENSION_DIR = path.join(process.cwd(), "extension");
const ZIP_NAME = "yoloapply-extension.zip";
const ROOT_FOLDER = "yoloapply-extension"; // folder users point "Load unpacked" at

function buildZip(): Buffer {
  if (cachedZip) return cachedZip;
  if (!fs.existsSync(EXTENSION_DIR)) {
    throw new Error("Extension source directory not found on the server.");
  }
  const zip = new AdmZip();
  zip.addLocalFolder(EXTENSION_DIR, ROOT_FOLDER);
  cachedZip = zip.toBuffer();
  return cachedZip;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const buf = buildZip();
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${ZIP_NAME}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
