// High-quality offline render of promo/intro.html:
// steps the page's virtual clock frame-by-frame (#record&frames mode),
// screenshots each frame losslessly, and pipes them into ffmpeg.
//
// Rendered in independent ~4s chunks, each in a FRESH browser: sustained 4K
// captures crash Chromium's browser process, so a crash must only cost one
// chunk. Chunks land in promo/_chunks/ and are skipped if present, so a
// killed run resumes where it left off. The virtual clock is deterministic,
// so replaying frames 0..N-1 in a new browser reproduces frame N exactly
// and chunks concatenate pixel-perfectly.
//
// Usage: npx tsx scripts/render-intro-frames.ts [width] [height] [outfile]
//   1080p: npx tsx scripts/render-intro-frames.ts            -> promo/intro-hq.mp4
//   4K:    npx tsx scripts/render-intro-frames.ts 3840 2160 promo/intro-4k.mp4
// Prereqs: npx tsx scripts/make-intro-audio.ts  (and ffmpeg-static installed)
try { process.loadEnvFile(".env") } catch {}
import { chromium, Browser, Page } from "playwright";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const FPS = 60;
const DUR_MS = 42000; // 40.5s timeline + outro hold
const W = Number(process.argv[2] || 1920);
const H = Number(process.argv[3] || 1080);
const OUT = process.argv[4] || "promo/intro-hq.mp4";
const CHUNK = 240; // frames per chunk (4s)
const CHUNK_DIR = "promo/_chunks";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffPath: string = require("ffmpeg-static");
const url = "file:///" + path.resolve("promo/intro.html").replace(/\\/g, "/") + "#record&frames";
const total = Math.ceil((DUR_MS / 1000) * FPS);
const msAt = (f: number) => (f / FPS) * 1000;
// Very large viewports can fail Page.captureScreenshot; above 1440p render a
// 1080p-ish viewport at 2x device pixels instead (same output resolution).
const dsf = W > 2560 ? 2 : 1;

function runFf(args: string[], stdin: "pipe" | "ignore" = "ignore") {
  return spawn(ffPath, ["-y", "-loglevel", "error", ...args], {
    stdio: [stdin, "inherit", "inherit"],
  });
}
const ffDone = (ff: ReturnType<typeof spawn>) =>
  new Promise<void>((res, rej) =>
    ff.on("close", (code) => (code === 0 ? res() : rej(new Error("ffmpeg exited " + code)))));

async function openPage(browser: Browser, replayTo: number): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: W / dsf, height: H / dsf },
    deviceScaleFactor: dsf,
  });
  await page.goto(url);
  await page.evaluate(() => (document as any).fonts.ready);
  await page.waitForTimeout(400);
  if (replayTo > 0) {
    await page.evaluate(
      (a) => { for (let k = 0; k < a.n; k++) (window as any).__frame((k / a.fps) * 1000); },
      { n: replayTo, fps: FPS },
    );
  }
  return page;
}

async function renderChunk(ci: number): Promise<void> {
  const startF = ci * CHUNK;
  const endF = Math.min(startF + CHUNK, total);
  const out = path.join(CHUNK_DIR, `c${String(ci).padStart(3, "0")}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    console.log(`chunk ${ci}: already rendered, skipping`);
    return;
  }
  const tmp = out + ".tmp.mp4";
  for (let attempt = 1; attempt <= 3; attempt++) {
    let browser: Browser | null = null;
    let ff: ReturnType<typeof spawn> | null = null;
    try {
      browser = await chromium.launch();
      const page = await openPage(browser, startF);
      ff = runFf([
        "-f", "image2pipe", "-c:v", "png", "-framerate", String(FPS), "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
        tmp,
      ], "pipe");
      const t0 = Date.now();
      for (let f = startF; f < endF; f++) {
        await page.evaluate((m) => (window as any).__frame(m), msAt(f));
        const buf = await page.screenshot({ type: "png", timeout: 60000 });
        if (!ff.stdin!.write(buf)) await new Promise((r) => ff!.stdin!.once("drain", r));
      }
      ff.stdin!.end();
      await ffDone(ff);
      fs.renameSync(tmp, out);
      const rate = (endF - startF) / ((Date.now() - t0) / 1000);
      console.log(`chunk ${ci} done (frames ${startF}-${endF - 1}, ${rate.toFixed(1)} fps)`);
      return;
    } catch (e) {
      console.log(`chunk ${ci} attempt ${attempt} failed: ${(e as Error).message.split("\n")[0]}`);
      try { ff?.kill(); } catch {}
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      if (attempt === 3) throw e;
    } finally {
      try { await browser?.close(); } catch {}
    }
  }
}

(async () => {
  if (!fs.existsSync("promo/intro-audio.wav")) {
    console.error("missing promo/intro-audio.wav — run: npx tsx scripts/make-intro-audio.ts");
    process.exit(1);
  }
  fs.mkdirSync(CHUNK_DIR, { recursive: true });

  const chunks = Math.ceil(total / CHUNK);
  for (let ci = 0; ci < chunks; ci++) await renderChunk(ci);

  // concat chunks (stream copy — identical encoder settings) + mux soundtrack
  const listFile = path.join(CHUNK_DIR, "list.txt");
  fs.writeFileSync(
    listFile,
    Array.from({ length: chunks }, (_, ci) =>
      `file 'c${String(ci).padStart(3, "0")}.mp4'`).join("\n"),
  );
  await ffDone(runFf([
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-i", "promo/intro-audio.wav",
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy",
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest", "-movflags", "+faststart",
    OUT,
  ]));
  fs.rmSync(CHUNK_DIR, { recursive: true, force: true });
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
  console.log(`done: ${OUT} (${mb} MB, ${W}x${H}@${FPS})`);
})();
