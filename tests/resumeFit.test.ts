import { describe, expect, it } from "vitest";
import { fitOnePage, ResumeFitError, GOOD_GAP, MAX_SCALE } from "../src/lib/resumeFit";
import type { ResumeDocument } from "../src/lib/resumeTemplate";

// A fake compiler: the "PDF" is the LaTeX itself, and the fake measure
// estimates height from it. Every bullet line costs a fixed amount scaled by
// the layout, so the fitter's decisions can be checked without TeX.
const PAGE = 1000;

function fakeMeasure(fixed: number, perBullet: number) {
  return async (pdf: Buffer) => {
    const tex = pdf.toString();
    const scale = Number(/scale ([\d.]+)/.exec(tex)![1]);
    const gap = Number(/extra gap ([\d.]+)pt/.exec(tex)![1]);
    const bullets = (tex.match(/\\item /g) ?? []).length;
    const sections = (tex.match(/\\ressection\{/g) ?? []).length - 1; // minus the macro definition
    const height = (fixed + bullets * perBullet) * scale + sections * gap * 1.3;
    return height > PAGE ? { pages: 2, bottomGap: 0 } : { pages: 1, bottomGap: (PAGE - height) / PAGE };
  };
}

const compile = async (tex: string) => Buffer.from(tex);

function doc(projects: number, bulletsEach = 3): ResumeDocument {
  return {
    name: "T", contacts: [], summary: "S", education: null, extras: [], skills: [{ label: "L", value: "x" }],
    experience: [{ company: "C", title: "T", location: "", dates: "", bullets: ["e1", "e2"] }],
    projects: Array.from({ length: projects }, (_, i) => ({
      slug: `p${i}`, title: `P${i}`, bullets: Array.from({ length: bulletsEach }, (_, j) => `b${i}.${j}`),
    })),
  };
}

describe("fitting a resume to one full page", () => {
  it("drops the lowest-ranked projects, then fills with part of the next one", async () => {
    // fixed 200 + 2 experience bullets: each project costs 3 * 50 = 150.
    const r = await fitOnePage(doc(10), compile, fakeMeasure(200, 50));
    // 300 + 4 * 150 = 900 fits whole; the 5th project fits with 2 bullets (1000).
    expect(r.projectCount).toBe(5);
    expect(r.tex).toContain("b4.1");
    expect(r.tex).not.toContain("b4.2");
    expect(r.tex).not.toContain("b5.0");
    expect(r.measure.pages).toBe(1);
    expect(r.measure.bottomGap).toBeLessThanOrEqual(GOOD_GAP);
  });

  it("keeps ranked order: only a prefix of the projects is kept", async () => {
    const r = await fitOnePage(doc(6), compile, fakeMeasure(200, 50));
    const kept = [...r.tex.matchAll(/P(\d)/g)].map((m) => Number(m[1]));
    expect(kept).toEqual([...kept].sort());
    expect(kept[0]).toBe(0);
  });

  it("grows the type when everything fits with room to spare", async () => {
    const r = await fitOnePage(doc(2), compile, fakeMeasure(200, 50));
    expect(r.projectCount).toBe(2);
    expect(r.layout.scale).toBeGreaterThan(1);
    expect(r.layout.scale).toBeLessThanOrEqual(MAX_SCALE);
    expect(r.measure.pages).toBe(1);
  });

  it("spreads a leftover gap across the sections when it cannot grow", async () => {
    // One short project at maximum scale still leaves room: spacing absorbs it.
    const r = await fitOnePage(doc(1, 1), compile, fakeMeasure(100, 50));
    expect(r.layout.extraGapPt).toBeGreaterThan(0);
    expect(r.measure.pages).toBe(1);
  });

  it("shrinks before giving up, and never clips", async () => {
    // 1 project at scale 1 is 1050; at the minimum scale it fits.
    const r = await fitOnePage(doc(3), compile, fakeMeasure(800, 50));
    expect(r.projectCount).toBe(1);
    expect(r.layout.scale).toBeLessThan(1);
    await expect(fitOnePage(doc(3), compile, fakeMeasure(1200, 50))).rejects.toBeInstanceOf(ResumeFitError);
  });

  it("stays within a small number of compiles", async () => {
    const r = await fitOnePage(doc(16), compile, fakeMeasure(200, 50));
    expect(r.compiles).toBeLessThanOrEqual(9);
  });
});
