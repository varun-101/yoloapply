import { personalizeResume } from "./personalize";
import { buildLatexResume, Tightness } from "./latex";
import { compileLatex, countPdfPages, clipToFirstPage } from "./compile";

export interface OnePageResult {
  tex: string;
  pdf: Buffer;
  tightness: Tightness;
  attempts: number;
  pages: number;
  clippedFromMultiPage: boolean;
}

interface Input {
  jobDescription: string;
  company: string;
  role: string;
}

// Personalize + compile, retrying with progressively tighter constraints until
// the rendered PDF is exactly one page. If even the tightest pass still overflows,
// clip to the first page as a last-resort safety net.
export async function personalizeOnePage(input: Input): Promise<OnePageResult> {
  const tightnesses: Tightness[] = [0, 1, 2];
  let lastTex = "";
  let lastPdf = Buffer.alloc(0);
  let lastPages = 0;
  let lastTightness: Tightness = 0;

  for (const t of tightnesses) {
    const draft = await personalizeResume({ ...input, tightness: t });
    const tex = buildLatexResume(draft, t);
    const pdf = await compileLatex(tex);
    const pages = await countPdfPages(pdf);
    lastTex = tex;
    lastPdf = pdf;
    lastPages = pages;
    lastTightness = t;
    if (pages <= 1) {
      return { tex, pdf, tightness: t, attempts: t + 1, pages, clippedFromMultiPage: false };
    }
  }

  // Still too long — clip to first page so we never return a 2-page resume.
  const clipped = await clipToFirstPage(lastPdf);
  return {
    tex: lastTex,
    pdf: clipped,
    tightness: lastTightness,
    attempts: tightnesses.length,
    pages: lastPages,
    clippedFromMultiPage: true,
  };
}
