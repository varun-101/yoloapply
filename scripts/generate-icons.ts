// Renders every PWA/home-screen icon from ONE vector source, so the mark can
// never drift between sizes. Run after changing the logo:
//   npx tsx scripts/generate-icons.ts
//
// The "Y" is drawn as geometry (stroked segments), not text — no webfont has
// to be available at render time, and it stays crisp at 48px.
//
// Three shapes come out of the same source:
//   any       — rounded square on transparency (browser tabs, Android "any")
//   maskable  — full-bleed amber, mark shrunk into the safe circle so Android
//               can crop it to a circle/squircle without clipping the Y
//   apple     — full-bleed amber square, no transparency (iOS rounds it itself
//               and composites transparent pixels onto black)
try { process.loadEnvFile(".env") } catch {}
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const AMBER = "#FFB224"; // signal.DEFAULT in tailwind.config.ts
const INK = "#0B0F1E"; // slate.950

type Shape = "any" | "maskable" | "apple";

/**
 * @param shape   corner/bleed treatment (see header)
 * @param mark    mark size as a fraction of the canvas; maskable icons keep it
 *                inside the 80% safe zone Android guarantees is never cropped
 */
function svg(shape: Shape, mark = 1): string {
  const S = 512;
  const bleed = shape !== "any";
  const radius = bleed ? 0 : 112; // ~22%, the iOS/Android squircle look
  // The mark is authored for a 512 canvas, then scaled about the centre.
  const t = `translate(${(S * (1 - mark)) / 2} ${(S * (1 - mark)) / 2}) scale(${mark})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect width="${S}" height="${S}" rx="${radius}" ry="${radius}" fill="${AMBER}"/>
  <g transform="${t}" fill="none" stroke="${INK}" stroke-width="52" stroke-linecap="round" stroke-linejoin="round">
    <path d="M168 156 L256 272 L344 156"/>
    <path d="M256 272 L256 368"/>
  </g>
</svg>`;
}

const OUT = path.resolve("public/icons");

const TARGETS: { file: string; shape: Shape; size: number; mark: number }[] = [
  { file: "icon-192.png", shape: "any", size: 192, mark: 1 },
  { file: "icon-512.png", shape: "any", size: 512, mark: 1 },
  { file: "maskable-192.png", shape: "maskable", size: 192, mark: 0.72 },
  { file: "maskable-512.png", shape: "maskable", size: 512, mark: 0.72 },
  { file: "apple-touch-icon.png", shape: "apple", size: 180, mark: 0.88 },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "icon.svg"), svg("any"));

  const browser = await chromium.launch();
  try {
    for (const { file, shape, size, mark } of TARGETS) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      // The SVG fills the viewport exactly, so the screenshot IS the icon.
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(shape, mark)}`
      );
      await page.screenshot({
        path: path.join(OUT, file),
        omitBackground: shape === "any",
      });
      await page.close();
      console.log("wrote", path.join("public/icons", file));
    }
    // Next serves src/app/icon.png as the favicon automatically.
    const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:256px;height:256px}</style>${svg("any")}`
    );
    await page.screenshot({ path: path.resolve("src/app/icon.png"), omitBackground: true });
    await page.close();
    console.log("wrote src/app/icon.png");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
