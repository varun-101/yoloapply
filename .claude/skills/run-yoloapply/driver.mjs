// YOLOapply driver — launches/attaches to the dev server and drives the UI
// with headless Chromium (uses the repo's own playwright dependency).
//
// Usage (run from anywhere, paths resolve relative to this file):
//   node .claude/skills/run-yoloapply/driver.mjs smoke      read-only smoke flow + screenshots
//   node .claude/skills/run-yoloapply/driver.mjs repl       interactive; or pipe commands on stdin
//
// REPL commands:
//   nav <path>              goto http://localhost:3001<path>, wait for DOM
//   wait <text>             wait until text is visible
//   waitsel <selector>      wait until selector is visible
//   click <selector>
//   fill <selector> <value>
//   select <selector> <value>   set a <select> (fires React onChange)
//   text <selector>         print innerText
//   get <apiPath>           fetch GET, print JSON
//   ss [name]               full-page screenshot -> screenshots/<name>.png
//   errors                  print console/page errors collected so far
//   exit
//
// IMPORTANT: this is Varun's live machine — real SQLite DB, paid DeepSeek key,
// real Gmail SMTP. The smoke flow is strictly read-only (GET pages/APIs and a
// filter change). Never POST /api/discovery/run, /api/cold-email/send, or
// promote/dismiss leads from automation unless explicitly asked.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SKILL_DIR, "..", "..", "..");
const BASE = process.env.YOLO_BASE_URL ?? "http://localhost:3001";
const SHOTS = path.join(SKILL_DIR, "screenshots");
const DEV_LOG = path.join(os.tmpdir(), "yoloapply-dev.log");
const DEV_PID = path.join(os.tmpdir(), "yoloapply-dev.pid");

fs.mkdirSync(SHOTS, { recursive: true });

async function serverUp() {
  try {
    // Any HTTP response means the server is alive. Clerk's auth.protect()
    // answers plain (non-browser) fetches of protected pages with 404, so
    // res.ok would call a healthy server dead.
    const res = await fetch(BASE, { signal: AbortSignal.timeout(4000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) {
    console.log(`server: already running at ${BASE} (left untouched)`);
    return;
  }
  console.log(`server: starting "npm run dev" (log: ${DEV_LOG})`);
  const log = fs.openSync(DEV_LOG, "a");
  const child = spawn("cmd", ["/c", "npm run dev"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
  });
  fs.writeFileSync(DEV_PID, String(child.pid));
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await serverUp()) {
      console.log(`server: up at ${BASE} (stop: taskkill /PID ${child.pid} /T /F)`);
      return;
    }
  }
  throw new Error(`dev server did not come up within 60s — check ${DEV_LOG}`);
}

const errors = [];

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}

// Viewport-only on purpose: fullPage on the discover feed (hundreds of leads)
// yields a 50,000px-tall image no human or model can read.
async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`screenshot: ${file}`);
}

// Navigate and wait for the page's data fetch to land (client pages render a
// spinner first; a screenshot taken too early shows only the loader).
async function navAndSettle(page, route, apiSubstring) {
  const resp = apiSubstring
    ? page.waitForResponse((r) => r.url().includes(apiSubstring), { timeout: 30000 })
    : null;
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (resp) await resp;
  await page.waitForTimeout(300); // one paint after the fetch resolves
}

async function smoke() {
  await ensureServer();

  // API checks (read-only)
  for (const [label, url, check] of [
    ["scan status", "/api/discovery/run", (d) => ["idle", "running"].includes(d.status)],
    ["scan history", "/api/discovery/scans?take=1", (d) => Array.isArray(d)],
    ["leads", "/api/discovery/leads?status=new", (d) => Array.isArray(d)],
  ]) {
    const res = await fetch(`${BASE}${url}`);
    const data = await res.json();
    if (!res.ok || !check(data)) throw new Error(`API ${label} (${url}) failed: ${JSON.stringify(data).slice(0, 200)}`);
    console.log(`API ${label}: ok`);
  }

  const browser = await chromium.launch();
  try {
    const page = await newPage(browser);

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByText("Recent applications").waitFor({ timeout: 30000 });
    await shot(page, "dashboard");

    await navAndSettle(page, "/discover", "/api/discovery/leads");
    await page.getByRole("button", { name: /Scan now|Scanning/ }).waitFor({ timeout: 15000 });
    await shot(page, "discover");

    // One real interaction: flip the status filter (fires a new leads fetch).
    const refetch = page.waitForResponse((r) => r.url().includes("/api/discovery/leads"), { timeout: 30000 });
    await page.locator("select").first().selectOption("all");
    await refetch;
    await page.waitForTimeout(300);
    await shot(page, "discover-all");

    await navAndSettle(page, "/discover/history", "/api/discovery/scans");
    await shot(page, "history");

    await page.goto(`${BASE}/applications`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    await shot(page, "applications");

    const real = errors.filter((e) => !e.includes("favicon"));
    if (real.length) {
      console.log(`\nFAIL — ${real.length} console/page error(s):`);
      for (const e of real) console.log(`  ${e}`);
      process.exitCode = 1;
    } else {
      console.log("\nPASS — all pages rendered, no console errors");
    }
  } finally {
    await browser.close();
  }
}

async function repl() {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await newPage(browser);
  const rl = readline.createInterface({ input: process.stdin });
  const prompt = () => process.stdout.isTTY && process.stdout.write("> ");
  prompt();
  for await (const line of rl) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(" ");
    try {
      if (!cmd) continue;
      else if (cmd === "exit" || cmd === "quit") break;
      else if (cmd === "nav") await page.goto(arg.startsWith("http") ? arg : `${BASE}${arg}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      else if (cmd === "wait") await page.getByText(arg).first().waitFor({ timeout: 30000 });
      else if (cmd === "waitsel") await page.locator(arg).first().waitFor({ timeout: 30000 });
      else if (cmd === "click") await page.locator(arg).first().click();
      else if (cmd === "fill") await page.locator(rest[0]).first().fill(rest.slice(1).join(" "));
      else if (cmd === "select") await page.locator(rest[0]).first().selectOption(rest.slice(1).join(" "));
      else if (cmd === "text") console.log(await page.locator(arg).first().innerText());
      else if (cmd === "get") console.log(JSON.stringify(await (await fetch(`${BASE}${arg}`)).json(), null, 2).slice(0, 3000));
      else if (cmd === "ss") await shot(page, arg || `shot-${Date.now()}`);
      else if (cmd === "errors") console.log(errors.length ? errors.join("\n") : "(none)");
      else console.log(`unknown command: ${cmd}`);
      if (cmd !== "ss" && cmd !== "text" && cmd !== "get" && cmd !== "errors") console.log("ok");
    } catch (e) {
      console.log(`error: ${e.message?.split("\n")[0]}`);
    }
    prompt();
  }
  await browser.close();
}

const mode = process.argv[2] ?? "repl";
if (mode === "smoke") smoke().catch((e) => { console.error(`FAIL — ${e.message}`); process.exit(1); });
else if (mode === "repl") repl().catch((e) => { console.error(e); process.exit(1); });
else { console.error(`unknown mode: ${mode} (use smoke|repl)`); process.exit(1); }
