// One-off: capture redesign screenshots for visual review.
try { process.loadEnvFile(".env"); } catch {}
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "http://localhost:3001";
const OUT = "storage/ui-review";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const targets: [string, string][] = [
    ["/", "dashboard"],
    ["/discover", "discover"],
    ["/applications", "applications"],
    ["/cold-email", "cold-email"],
  ];

  for (const theme of ["dark", "light"] as const) {
    await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
    for (const [path, name] of targets) {
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
      console.log(`captured ${name}-${theme}`);
    }
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
