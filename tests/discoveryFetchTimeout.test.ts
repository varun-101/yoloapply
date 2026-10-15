import { afterEach, expect, it, vi } from "vitest";
import { fetchHnLeads } from "@/lib/discovery/hn";
import { fetchJobfoundLeads } from "@/lib/discovery/jobfound";
import { fetchSheetLeads } from "@/lib/discovery/sheet";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  ["hn", fetchHnLeads],
  ["jobfound", fetchJobfoundLeads],
  ["sheet", fetchSheetLeads],
] as const)("%s aborts a stalled fetch and returns a source error", async (source, fetchLeads) => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-only");
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => {
    expect(init?.signal).toBe(controller.signal);
    return new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("source fetch timed out")), { once: true });
    });
  }));
  const result = fetchLeads();
  expect(timeout).toHaveBeenCalledWith(20_000);
  controller.abort();
  await expect(result).resolves.toMatchObject({ source, leads: [], error: "source fetch timed out" });
});
