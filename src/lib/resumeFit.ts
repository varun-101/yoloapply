import { getDocumentProxy } from "unpdf";
import { buildResumeTex, gapSlots, type ResumeDocument, type ResumeLayout } from "./resumeTemplate";

// Picks how much of a tailored resume goes on the page, and at what size, by
// compiling and measuring the real PDF. The old generator re-ran the LLM with
// harsher length limits on overflow and accepted the first one-page result,
// which routinely left a fifth of the page blank; this one keeps the words the
// model wrote and only varies the project count, the scale and the spacing.

export interface PdfMeasure {
  pages: number;
  // Fraction of the first page's height below the last line of text.
  bottomGap: number;
}

export interface FitResult {
  tex: string;
  pdf: Buffer;
  measure: PdfMeasure;
  layout: ResumeLayout;
  projectCount: number;
  compiles: number;
}

export type Compile = (tex: string) => Promise<Buffer>;
export type Measure = (pdf: Buffer) => Promise<PdfMeasure>;

// The reference resume leaves ~3.5% below its last line (bottom margin
// included). Anything at or under GOOD_GAP is treated as a full page.
export const GOOD_GAP = 0.06;
// What the spacing pass aims for; a little slack absorbs rounding.
const FILL_TARGET_GAP = 0.04;
export const MIN_SCALE = 0.9;
export const MAX_SCALE = 1.25;
const MAX_EXTRA_GAP_PT = 8;
const LETTER_HEIGHT_PT = 792;
const SCALE_SEARCH_STEPS = 3;

export class ResumeFitError extends Error {}

export async function measurePdf(pdf: Buffer): Promise<PdfMeasure> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  try {
    const page = await doc.getPage(1);
    const height = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    let lowest = height;
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      // transform[5] is the baseline's distance from the bottom edge; take
      // descenders into account roughly via the item height.
      const y = item.transform[5] - item.height * 0.25;
      if (y < lowest) lowest = y;
    }
    return { pages: doc.numPages, bottomGap: Math.max(0, lowest) / height };
  } finally {
    await doc.destroy();
  }
}

export function withProjects(doc: ResumeDocument, count: number, lastBullets?: number): ResumeDocument {
  const projects = doc.projects.slice(0, count).map((p) => ({ ...p, bullets: [...p.bullets] }));
  if (lastBullets !== undefined && projects.length) {
    const last = projects[projects.length - 1];
    last.bullets = last.bullets.slice(0, lastBullets);
  }
  return { ...doc, projects };
}

export async function fitOnePage(
  doc: ResumeDocument,
  compile: Compile,
  measure: Measure = measurePdf
): Promise<FitResult> {
  let compiles = 0;
  const render = async (d: ResumeDocument, layout: ResumeLayout) => {
    const tex = buildResumeTex(d, layout);
    const pdf = await compile(tex);
    compiles++;
    const m = await measure(pdf);
    return { tex, pdf, measure: m, layout, doc: d, fits: m.pages === 1 };
  };
  type Rendered = Awaited<ReturnType<typeof render>>;

  const base: ResumeLayout = { scale: 1, extraGapPt: 0 };
  let best: Rendered;

  const all = await render(doc, base);
  if (all.fits) {
    best = all;
    // Everything fits at the reference size: grow the type into the space
    // rather than leaving it blank (sparse profiles, short project banks).
    if (best.measure.bottomGap > GOOD_GAP) {
      let lo = 1;
      let hi = MAX_SCALE;
      for (let i = 0; i < SCALE_SEARCH_STEPS; i++) {
        const mid = (lo + hi) / 2;
        const r = await render(doc, { scale: mid, extraGapPt: 0 });
        if (r.fits) {
          lo = mid;
          best = r;
          if (r.measure.bottomGap <= GOOD_GAP) break;
        } else {
          hi = mid;
        }
      }
    }
  } else {
    // Too much content: keep the largest prefix of the ranked projects that
    // fits, but never fewer than one project when the bank has any.
    let lo = Math.min(1, doc.projects.length); // assumed to fit, verified below
    let hi = doc.projects.length; // known to overflow
    let fitting: Rendered | null = null;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const r = await render(withProjects(doc, mid), base);
      if (r.fits) {
        lo = mid;
        fitting = r;
      } else {
        hi = mid;
      }
    }
    if (!fitting && lo < doc.projects.length) {
      const r = await render(withProjects(doc, lo), base);
      if (r.fits) fitting = r;
    }
    if (fitting) {
      best = fitting;
    } else {
      // The fixed sections alone nearly fill the page; shrink once.
      const r = await render(withProjects(doc, lo), { scale: MIN_SCALE, extraGapPt: 0 });
      if (!r.fits) {
        throw new ResumeFitError(
          "The resume does not fit on one page even with a single project. Shorten the experience bullets in Settings → Profile."
        );
      }
      best = r;
    }
    // The next project did not fit whole; a shortened version often fills
    // the gap it would otherwise leave.
    const next = doc.projects[lo];
    if (next && best.layout.scale === 1 && best.measure.bottomGap > GOOD_GAP) {
      // Largest bullet prefix of the next project that still fits.
      let few = 0; // fits (it is `best`)
      let many = next.bullets.length; // known to overflow
      while (many - few > 1) {
        const mid = Math.floor((few + many) / 2);
        const r = await render(withProjects(doc, lo + 1, mid), base);
        if (r.fits) {
          few = mid;
          best = r;
        } else {
          many = mid;
        }
      }
    }
  }

  // Spread what is left across the section and project gaps.
  if (best.measure.bottomGap > GOOD_GAP) {
    const spare = (best.measure.bottomGap - FILL_TARGET_GAP) * LETTER_HEIGHT_PT;
    const slots = gapSlots(best.doc);
    const extra = Math.min(MAX_EXTRA_GAP_PT, slots > 0 ? spare / slots : 0);
    if (extra >= 0.5) {
      const r = await render(best.doc, { ...best.layout, extraGapPt: Math.floor(extra * 10) / 10 });
      if (r.fits) best = r;
    }
  }

  return {
    tex: best.tex,
    pdf: best.pdf,
    measure: best.measure,
    layout: best.layout,
    projectCount: best.doc.projects.length,
    compiles,
  };
}
