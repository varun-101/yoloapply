import { describe, expect, it } from "vitest";
import { mergeAndRank, recruiterRelevanceRank } from "@/lib/contacts/rank";

describe("recruiter ranking", () => {
  it("ranks a relevant person without an email above a generic role inbox", () => {
    const ranked = mergeAndRank([
      { name: "Asha Rao", title: "Engineering Recruiter", source: "apollo", providerPersonId: "p1", confidence: 0 },
      { email: "careers@acme.com", source: "role_inbox", confidence: 0.8 },
    ]);
    expect(ranked[0]).toMatchObject({ name: "Asha Rao", source: "apollo" });
    expect(ranked[1]).toMatchObject({ email: "careers@acme.com", source: "role_inbox" });
  });

  it("boosts a recruiter in the user's preferred geography", () => {
    expect(recruiterRelevanceRank("Recruiter", "Bengaluru, India", "India"))
      .toBeGreaterThan(recruiterRelevanceRank("Recruiter", "New York, United States", "India"));
  });
});
