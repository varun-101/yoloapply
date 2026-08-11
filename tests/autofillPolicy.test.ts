import { describe, expect, it } from "vitest";
import { enforceAutofillDecisions, enforceAutofillPolicy } from "@/lib/application-agent/autofill-policy";

describe("autofill policy", () => {
  it("allows a high-confidence ordinary profile field", () => {
    expect(
      enforceAutofillPolicy(
        { id: "first", label: "First name", required: true },
        { id: "first", kind: "profile", profileKey: "firstName", value: "Ada", confidence: "high" }
      )
    ).toMatchObject({ kind: "profile", value: "Ada", requiresHumanReview: false });
  });

  it("never fills demographic answers proposed by the model", () => {
    expect(
      enforceAutofillPolicy(
        { id: "gender", label: "Gender", required: true, options: ["Woman", "Man"] },
        { id: "gender", kind: "select", value: "Woman", confidence: "high" }
      )
    ).toMatchObject({
      kind: "skip",
      value: "",
      requiresHumanReview: true,
      sensitivity: "demographics",
    });
  });

  it("allows a saved work-authorization answer only through its canonical profile key", () => {
    const field = { id: "auth", label: "Are you authorized to work in India?", required: true };
    expect(
      enforceAutofillPolicy(field, {
        id: "auth",
        kind: "profile",
        profileKey: "workAuthorization",
        value: "Yes",
        confidence: "high",
      })
    ).toMatchObject({ kind: "profile", value: "Yes", requiresHumanReview: false });

    expect(
      enforceAutofillPolicy(field, {
        id: "auth",
        kind: "generated",
        value: "Yes",
        confidence: "high",
      })
    ).toMatchObject({ kind: "skip", requiresHumanReview: true, sensitivity: "work_authorization" });
  });

  it("blocks medium- and low-confidence mappings", () => {
    expect(
      enforceAutofillPolicy(
        { id: "city", label: "City", required: true },
        { id: "city", kind: "profile", value: "Pune", confidence: "medium" }
      )
    ).toMatchObject({ kind: "skip", value: "", requiresHumanReview: true });
  });

  it("rejects select values that are not exact options", () => {
    expect(
      enforceAutofillPolicy(
        { id: "notice", label: "Notice period", required: true, options: ["Immediate", "30 days"] },
        { id: "notice", kind: "select", value: "One month", confidence: "high" }
      )
    ).toMatchObject({ kind: "skip", requiresHumanReview: true });
  });

  it("returns a review decision for every field, even when the model omits one", () => {
    const decisions = enforceAutofillDecisions(
      [
        { id: "email", label: "Email", required: true },
        { id: "salary", label: "Expected salary", required: true },
      ],
      [{ id: "email", kind: "profile", profileKey: "email", value: "ada@example.com", confidence: "high" }]
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[1]).toMatchObject({ kind: "skip", sensitivity: "compensation", requiresHumanReview: true });
  });
});
