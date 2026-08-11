import { describe, expect, it } from "vitest";
import { deriveApplicationReadiness } from "@/lib/application-agent/workflow-types";

describe("deriveApplicationReadiness", () => {
  it("is not started while every required task is pending", () => {
    expect(
      deriveApplicationReadiness([
        { required: true, status: "PENDING" },
        { required: true, status: "PENDING" },
        { required: false, status: "SUCCESS" },
      ])
    ).toBe("NOT_STARTED");
  });

  it("is preparing while required work is running or incomplete", () => {
    expect(
      deriveApplicationReadiness([
        { required: true, status: "SUCCESS" },
        { required: true, status: "RUNNING" },
        { required: true, status: "PENDING" },
      ])
    ).toBe("PREPARING");
  });

  it("prioritizes failures over review and progress", () => {
    expect(
      deriveApplicationReadiness([
        { required: true, status: "FAILED" },
        { required: true, status: "NEEDS_REVIEW" },
        { required: true, status: "RUNNING" },
      ])
    ).toBe("FAILED");
  });

  it("surfaces required human review", () => {
    expect(
      deriveApplicationReadiness([
        { required: true, status: "SUCCESS" },
        { required: true, status: "NEEDS_REVIEW" },
      ])
    ).toBe("NEEDS_REVIEW");
  });

  it("is ready when all required tasks terminate successfully or are explicitly skipped", () => {
    expect(
      deriveApplicationReadiness([
        { required: true, status: "SUCCESS" },
        { required: true, status: "SKIPPED" },
        { required: false, status: "PENDING" },
      ])
    ).toBe("READY");
  });
});
