import { describe, expect, it } from "vitest";
import { detectAtsProvider, normalizePreparationReport } from "@/lib/application-agent/preparation";

describe("application preparation reports", () => {
  it("detects supported ATS providers from their URLs", () => {
    expect(detectAtsProvider("https://boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectAtsProvider("https://jobs.lever.co/acme/123")).toBe("lever");
    expect(detectAtsProvider("https://jobs.ashbyhq.com/acme/123")).toBe("ashby");
    expect(detectAtsProvider("https://acme.wd5.myworkdayjobs.com/job/123")).toBe("workday");
    expect(detectAtsProvider("javascript:alert(1)")).toBe("generic");
  });

  it("stores no field values and derives trustworthy counts", () => {
    const report = normalizePreparationReport(
      {
        pageUrl: "https://jobs.lever.co/acme/123#apply",
        fields: [
          { id: "email", label: "Email", value: "secret@example.com", status: "filled", required: true },
          { id: "salary", label: "Expected salary", status: "needs_review", sensitivity: "compensation" },
          { id: "newsletter", label: "Newsletter", status: "skipped", required: false },
        ],
        resumeAttached: true,
      },
      undefined,
      new Date("2026-08-10T12:00:00.000Z")
    );

    expect(report).toMatchObject({
      atsProvider: "lever",
      filledCount: 1,
      reviewCount: 1,
      skippedCount: 1,
      resumeAttached: true,
      capturedAt: "2026-08-10T12:00:00.000Z",
    });
    expect(report.fields[0]).not.toHaveProperty("value");
  });

  it("merges attachment-only updates without losing the previous field report", () => {
    const previous = normalizePreparationReport({
      fields: [{ id: "name", label: "Name", status: "filled" }],
      resumeAttached: false,
    });
    const updated = normalizePreparationReport({ resumeAttached: true }, previous);
    expect(updated.fields).toHaveLength(1);
    expect(updated.filledCount).toBe(1);
    expect(updated.resumeAttached).toBe(true);
  });
});
