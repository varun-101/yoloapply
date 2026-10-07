import { tailorResume, loadPersonalizeContext } from "./personalize";
import { fitOnePage } from "./resumeFit";
import { compileLatex } from "./compile";
import type { ResumeLayout } from "./resumeTemplate";

export interface OnePageResult {
  tex: string;
  pdf: Buffer;
  layout: ResumeLayout;
  projectCount: number;
  compiles: number;
  bottomGapPct: number;
}

interface Input {
  jobDescription: string;
  company: string;
  role: string;
}

// One tailoring call on the user's master resume, then a measured fit: the
// project count, type scale and spacing are chosen from the compiled PDF so
// the page is one full page. Overflow is never clipped; if nothing fits,
// fitOnePage throws and the run is recorded as failed.
export async function personalizeOnePage(userId: string, input: Input): Promise<OnePageResult> {
  const ctx = await loadPersonalizeContext(userId);
  const doc = await tailorResume(ctx, input);
  const fit = await fitOnePage(doc, compileLatex);
  return {
    tex: fit.tex,
    pdf: fit.pdf,
    layout: fit.layout,
    projectCount: fit.projectCount,
    compiles: fit.compiles,
    bottomGapPct: Math.round(fit.measure.bottomGap * 1000) / 10,
  };
}

export function describeFit(result: OnePageResult): string {
  return (
    `${result.projectCount} project${result.projectCount === 1 ? "" : "s"}, ` +
    `scale ${result.layout.scale.toFixed(2)}, ${result.bottomGapPct}% blank below the last line ` +
    `(${result.compiles} compile${result.compiles === 1 ? "" : "s"})`
  );
}

export function fitMetadata(result: OnePageResult) {
  return {
    projectCount: result.projectCount,
    scale: result.layout.scale,
    extraGapPt: result.layout.extraGapPt,
    bottomGapPct: result.bottomGapPct,
    compiles: result.compiles,
  };
}
