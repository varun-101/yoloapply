/* eslint-disable @typescript-eslint/no-explicit-any */
// Playwright auto-apply worker.
// Run via:  node --experimental-strip-types scripts/auto-apply.ts --id <applicationId>
// Or compile and run from the Next.js route via spawn(node, ...).
//
// The worker opens the application's applyUrl in a headed browser, attempts to fill
// common fields (name, email, phone, GitHub, LinkedIn, portfolio), uploads the
// generated PDF, then STOPS for human review before submit.
//
// Important: this intentionally does NOT click submit. LinkedIn/portals routinely
// have CAPTCHAs, custom multi-step flows, and ToS implications around full automation.
// The agent does the boring 80% and leaves the human in the loop for the final click.

import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";
import { owner } from "../src/lib/owner";

const prisma = new PrismaClient();

async function main() {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
  }
  const id = args.get("id");
  if (!id) {
    console.error("usage: auto-apply.ts --id <applicationId>");
    process.exit(2);
  }

  const app = await prisma.application.findUnique({ where: { id } });
  if (!app) {
    console.error("application not found:", id);
    process.exit(2);
  }
  if (!app.applyUrl) {
    console.error("application has no applyUrl");
    process.exit(2);
  }
  if (!app.resumePdfPath || !existsSync(app.resumePdfPath)) {
    console.error("no personalized PDF found; personalize first");
    process.exit(2);
  }

  console.log("Launching browser…");
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  console.log("Navigating:", app.applyUrl);
  await page.goto(app.applyUrl, { waitUntil: "domcontentloaded" });

  // LinkedIn Easy Apply detector.
  if (app.applyUrl.includes("linkedin.com")) {
    console.log("LinkedIn URL detected — attempting Easy Apply flow.");
    try {
      // The user must already be signed in (saved state) — we don't store creds here.
      const easyApply = await page
        .locator('button:has-text("Easy Apply")')
        .first()
        .elementHandle({ timeout: 8000 })
        .catch(() => null);
      if (easyApply) await (easyApply as any).click();
    } catch (e) {
      console.log("Easy Apply button not found:", (e as Error).message);
    }
  }

  // Generic best-effort field fill.
  const fills: { selectors: string[]; value: string }[] = [
    { selectors: ["input[name*='first' i]", "input[id*='first' i]", "input[autocomplete='given-name']"], value: owner.name.split(" ")[0] },
    { selectors: ["input[name*='last' i]", "input[id*='last' i]", "input[autocomplete='family-name']"], value: owner.name.split(" ").slice(1).join(" ") },
    { selectors: ["input[type='email']", "input[name*='email' i]"], value: owner.email },
    { selectors: ["input[type='tel']", "input[name*='phone' i]"], value: owner.phone },
    { selectors: ["input[name*='github' i]", "input[id*='github' i]"], value: owner.github },
    { selectors: ["input[name*='linkedin' i]", "input[id*='linkedin' i]"], value: owner.linkedin },
    { selectors: ["input[name*='portfolio' i]", "input[name*='website' i]", "input[id*='website' i]"], value: owner.portfolio },
  ];

  for (const f of fills) {
    for (const sel of f.selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        try {
          await loc.fill(f.value, { timeout: 1500 });
          console.log("Filled", sel, "=", f.value.slice(0, 40));
          break;
        } catch {
          // ignore
        }
      }
    }
  }

  // Resume upload — any input[type=file] that mentions resume/cv.
  const fileInputs = await page.locator("input[type='file']").all();
  for (const fi of fileInputs) {
    try {
      const nameAttr = (await fi.getAttribute("name")) ?? "";
      const idAttr = (await fi.getAttribute("id")) ?? "";
      const blob = (nameAttr + " " + idAttr).toLowerCase();
      if (/resume|cv|file/.test(blob) || fileInputs.length === 1) {
        await fi.setInputFiles(app.resumePdfPath);
        console.log("Uploaded resume to file input:", nameAttr || idAttr || "(unnamed)");
        break;
      }
    } catch (e) {
      console.log("Upload failed:", (e as Error).message);
    }
  }

  await prisma.event.create({
    data: {
      applicationId: app.id,
      type: "note",
      detail: "Auto-apply worker prefilled the form. Browser left open for human review/submit.",
    },
  });

  console.log("\nDone prefilling. Review the form, then click submit yourself.");
  console.log("Close the browser window when finished. (The worker will exit.)");

  // Wait until the browser is closed by the user.
  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
  });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
