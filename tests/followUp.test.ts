import { describe, expect, it } from "vitest";
import { buildFollowUpDraft, followUpDate } from "@/lib/application-agent/follow-up";

describe("follow-up scheduling", () => {
  it("uses the configured day delay and clamps unsafe values", () => {
    const sent = new Date("2026-08-10T10:00:00.000Z");
    expect(followUpDate(sent, 5).toISOString()).toBe("2026-08-15T10:00:00.000Z");
    expect(followUpDate(sent, 0).toISOString()).toBe("2026-08-15T10:00:00.000Z");
    expect(followUpDate(sent, 99).toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });

  it("builds a concise draft without claiming a reply or recruiter ownership", () => {
    const draft = buildFollowUpDraft({
      candidateName: "Ada Lovelace",
      recipientName: "Grace Hopper",
      role: "Backend Engineer",
      company: "Acme",
      originalSubject: "Backend Engineer application",
    });
    expect(draft.subject).toBe("Re: Backend Engineer application");
    expect(draft.body).toContain("Hi Grace,");
    expect(draft.body).toContain("Backend Engineer opportunity at Acme");
    expect(draft.body).not.toMatch(/your role|you posted|thanks for replying/i);
  });
});
