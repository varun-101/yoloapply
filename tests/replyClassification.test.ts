import { describe, expect, it } from "vitest";
import { classifyReplyDeterministically } from "@/lib/application-agent/replies";

describe("reply classification", () => {
  it.each([
    ["Interview availability", "Please share your availability for an interview.", "INTERVIEW"],
    ["Next step", "Complete this HackerRank coding assessment.", "ASSESSMENT"],
    ["Your application", "Unfortunately we are not moving forward.", "REJECTION"],
    ["More details", "Could you please provide your latest resume?", "REQUEST_INFO"],
  ])("classifies %s", (subject, body, expected) => {
    expect(classifyReplyDeterministically(subject, body)?.classification).toBe(expected);
  });

  it("returns null for ambiguous replies so the configured classifier can handle them", () => {
    expect(classifyReplyDeterministically("Hello", "Thanks for your message.")).toBeNull();
  });
});
