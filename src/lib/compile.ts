import { spawn } from "child_process";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { PDFDocument } from "pdf-lib";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

export async function ensureStorage(): Promise<string> {
  const abs = path.resolve(STORAGE_DIR);
  await mkdir(abs, { recursive: true });
  return abs;
}

function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const child = spawn(cmd, [bin]);
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => resolve(code === 0 ? out.split(/\r?\n/)[0].trim() : null));
    child.on("error", () => resolve(null));
  });
}

async function runLocal(bin: string, tex: string): Promise<Buffer> {
  const tmp = await mkdir(path.join(os.tmpdir(), `yoloapply-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
  const dir = tmp as unknown as string;
  const texPath = path.join(dir, "resume.tex");
  await writeFile(texPath, tex, "utf8");

  await new Promise<void>((resolve, reject) => {
    const args =
      bin.endsWith("tectonic") || bin.endsWith("tectonic.exe")
        ? [texPath, "--outdir", dir, "-Z", "search-path=."]
        : ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", dir, texPath];
    const child = spawn(bin, args, { cwd: dir });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {});
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`LaTeX compile failed (${bin}): ${stderr.slice(-500)}`));
    });
    child.on("error", reject);
  });

  const pdf = await readFile(path.join(dir, "resume.pdf"));
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return pdf;
}

async function runRemoteTexliveNet(tex: string): Promise<Buffer> {
  // texlive.net CGI endpoint expects multipart/form-data.
  const fd = new FormData();
  fd.set("engine", "pdflatex");
  fd.set("return", "pdf");
  fd.append("filename[]", "document.tex");
  fd.append("filecontents[]", tex);
  const res = await fetch("https://texlive.net/cgi-bin/latexcgi", {
    method: "POST",
    body: fd,
  });
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.subarray(0, 4).toString() === "%PDF") return buf;
  // If the response is HTML it contains a redirect link — follow it manually.
  const txt = buf.toString();
  const m = txt.match(/href="([^"]+\.pdf)"/i);
  if (m) {
    const pdfUrl = m[1].startsWith("http") ? m[1] : `https://texlive.net${m[1]}`;
    const pres = await fetch(pdfUrl);
    const pbuf = Buffer.from(await pres.arrayBuffer());
    if (pbuf.subarray(0, 4).toString() === "%PDF") return pbuf;
  }
  throw new Error(
    `texlive.net compile failed (${res.status}): ` + txt.slice(0, 800)
  );
}

async function runRemoteYtotech(tex: string): Promise<Buffer> {
  // latex.ytotech.com — POSTs a JSON document spec.
  const body = {
    compiler: "pdflatex",
    resources: [{ main: true, content: tex }],
  };
  const res = await fetch("https://latex.ytotech.com/builds/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.subarray(0, 4).toString() === "%PDF") return buf;
  throw new Error(
    `latex.ytotech.com compile failed (${res.status}): ` + buf.subarray(0, 1000).toString().slice(0, 800)
  );
}

async function runRemote(tex: string): Promise<Buffer> {
  const attempts: { name: string; fn: (t: string) => Promise<Buffer> }[] = [
    { name: "texlive.net", fn: runRemoteTexliveNet },
    { name: "latex.ytotech.com", fn: runRemoteYtotech },
  ];
  const errs: string[] = [];
  for (const a of attempts) {
    try {
      return await a.fn(tex);
    } catch (e) {
      errs.push(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error("All remote LaTeX services failed.\n\n" + errs.join("\n\n"));
}

export async function compileLatex(tex: string): Promise<Buffer> {
  const mode = (process.env.LATEX_MODE ?? "remote").toLowerCase();
  if (mode === "local") {
    const tectonic = await which("tectonic");
    if (tectonic) return runLocal(tectonic, tex);
    const pdflatex = await which("pdflatex");
    if (pdflatex) return runLocal(pdflatex, tex);
    throw new Error("LATEX_MODE=local but neither tectonic nor pdflatex were found on PATH.");
  }
  // Default: try local first opportunistically, fall back to remote.
  const tectonic = await which("tectonic");
  if (tectonic) return runLocal(tectonic, tex);
  const pdflatex = await which("pdflatex");
  if (pdflatex) return runLocal(pdflatex, tex);
  return runRemote(tex);
}

export async function saveResumeArtifacts(
  applicationId: string,
  tex: string,
  pdf: Buffer
): Promise<{ texPath: string; pdfPath: string }> {
  const base = await ensureStorage();
  const dir = path.join(base, "applications", applicationId);
  await mkdir(dir, { recursive: true });
  const texPath = path.join(dir, "resume.tex");
  const pdfPath = path.join(dir, "resume.pdf");
  await writeFile(texPath, tex, "utf8");
  await writeFile(pdfPath, pdf);
  return { texPath, pdfPath };
}

export function pdfExists(p: string | null | undefined): boolean {
  return !!p && existsSync(p);
}

export async function saveCoverLetterPdf(
  applicationId: string,
  pdf: Buffer
): Promise<{ pdfPath: string }> {
  const base = await ensureStorage();
  const dir = path.join(base, "applications", applicationId);
  await mkdir(dir, { recursive: true });
  const pdfPath = path.join(dir, "cover-letter.pdf");
  await writeFile(pdfPath, pdf);
  return { pdfPath };
}

export async function countPdfPages(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

// Drop every page after the first. Last-resort safety net when even the tightest
// regeneration still overflowed.
export async function clipToFirstPage(pdf: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  const total = doc.getPageCount();
  if (total <= 1) return pdf;
  for (let i = total - 1; i >= 1; i--) doc.removePage(i);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
