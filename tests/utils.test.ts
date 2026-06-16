import { describe, it, expect } from "vitest";
import { cn, formatDate, statusColor, statusBarColor } from "@/lib/utils";
import { sourceTier } from "@/lib/discovery/types";

describe("cn", () => {
  it("merges conditional classes and dedupes tailwind conflicts", () => {
    expect(cn("px-2", false && "hidden", "px-4")).toBe("px-4");
    expect(cn("text-slate-500", "text-slate-700")).toBe("text-slate-700");
  });
});

describe("formatDate", () => {
  it("renders a placeholder for nullish input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("formats a date as 'Mon D, YYYY'", () => {
    expect(formatDate(new Date("2026-06-15T12:00:00Z"))).toBe("Jun 15, 2026");
    expect(formatDate("2026-01-02T12:00:00Z")).toBe("Jan 2, 2026");
  });
});

describe("statusColor / statusBarColor", () => {
  it("returns a distinct class for each known status", () => {
    for (const s of ["draft", "personalized", "applied", "interview", "offer", "rejected"]) {
      expect(statusColor(s)).toContain("dark:");
      expect(statusBarColor(s)).toContain("bg-");
    }
  });

  it("falls back to a neutral class for unknown statuses", () => {
    expect(statusColor("bogus")).toBe(statusColor("__unknown__"));
    expect(statusBarColor("bogus")).toBe(statusBarColor("__unknown__"));
  });
});

describe("sourceTier", () => {
  it("returns the configured tier for known sources", () => {
    expect(sourceTier("sheet")).toBe(1);
    expect(sourceTier("greenhouse")).toBe(2);
    expect(sourceTier("hn")).toBe(3);
  });

  it("returns a low-priority default for unknown sources", () => {
    expect(sourceTier("mystery")).toBe(9);
  });
});
