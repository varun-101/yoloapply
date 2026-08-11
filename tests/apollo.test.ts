import { describe, expect, it, vi } from "vitest";
import { fetchApolloContacts, resolveApolloContact } from "@/lib/contacts/lanes/apollo";

describe("Apollo recruiter provider", () => {
  it("uses the current People Search endpoint and returns people without assuming emails", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ people: [{ id: "p1", name: "Asha Rao", title: "Engineering Recruiter", city: "Bengaluru", country: "India", linkedin_url: "https://linkedin.com/in/asha" }] }), { status: 200 }));
    const result = await fetchApolloContacts("acme.com", "Acme", "secret", "India", request);
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.pathname).toContain("/mixed_people/api_search");
    expect(url.searchParams.getAll("q_organization_domains_list[]")).toEqual(["acme.com"]);
    expect(url.searchParams.getAll("person_locations[]")).toEqual(["India"]);
    expect(url.searchParams.getAll("person_titles[]")).toContain("technical recruiter");
    expect(result.candidates[0]).toMatchObject({ providerPersonId: "p1", name: "Asha Rao", location: "Bengaluru, India", contactStatus: "not_requested" });
    expect(result.candidates[0].email).toBeUndefined();
  });

  it("enriches only a selected Apollo person", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ person: { id: "p1", name: "Asha Rao", title: "Engineering Recruiter", email: "asha@acme.com", email_status: "verified" } }), { status: 200 }));
    const result = await resolveApolloContact("secret", { providerPersonId: "p1", domain: "acme.com" }, request);
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.pathname).toContain("/people/match");
    expect(url.searchParams.get("id")).toBe("p1");
    expect(url.searchParams.get("reveal_phone_number")).toBe("false");
    expect(result).toMatchObject({ email: "asha@acme.com", verified: true, contactStatus: "resolved" });
  });

  it("reports Apollo Free-plan API restrictions separately from invalid credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "not included in Free plan", error_code: "API_INACCESSIBLE" }), { status: 403 }));
    const result = await fetchApolloContacts("acme.com", "Acme", "secret", "India", request);
    expect(result.status).toBe("plan_required");
    expect(result.error).toContain("paid Apollo plan");
    expect(result.error).not.toContain("secret");
  });
});
