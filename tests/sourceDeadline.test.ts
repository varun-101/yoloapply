import { describe, it, expect, vi } from "vitest";
import { withDeadline } from "@/lib/discovery/pipeline";
import type { FetchResult } from "@/lib/discovery/types";

const failed = (source: string) => (error: string): FetchResult => ({ source, leads: [], error });

describe("withDeadline", () => {
  it("passes a successful source straight through", async () => {
    const ok: FetchResult = { source: "sheet", leads: [], error: undefined };
    await expect(withDeadline("sheet", Promise.resolve(ok), failed("sheet"), 50)).resolves.toBe(ok);
  });

  it("resolves a source that never settles, so the fetch is never wedged", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<FetchResult>(() => {});
      const raced = withDeadline("instahyre", never, failed("instahyre"), 60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      const out = await raced;
      expect(out.leads).toEqual([]);
      expect(out.error).toContain("deadline");
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a throwing source into a failed result instead of sinking the run", async () => {
    const out = await withDeadline(
      "ATS boards",
      Promise.reject(new Error("db write failed")),
      failed("greenhouse"),
      50
    );
    expect(out).toEqual({ source: "greenhouse", leads: [], error: "db write failed" });
  });

  it("does not fire the deadline once the source has settled", async () => {
    vi.useFakeTimers();
    try {
      const ok: FetchResult = { source: "hn", leads: [] };
      const raced = withDeadline("hn", Promise.resolve(ok), failed("hn"), 1_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await raced).toBe(ok);
    } finally {
      vi.useRealTimers();
    }
  });
});
