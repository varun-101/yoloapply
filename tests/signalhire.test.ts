import { describe, expect, it, vi } from "vitest";
import { fetchSignalHireContacts, resolveSignalHireContact } from "@/lib/contacts/lanes/signalhire";

describe("SignalHire recruiter provider", () => {
  it("discovers location-filtered recruiter profiles without spending person credits", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ profiles: [{ uid: "u1", fullName: "Jane Recruiter", location: "Bengaluru, India", experience: [{ company: "Acme", title: "Technical Recruiter", current: true }] }] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Credits-Left": "17" },
      })
    );

    const result = await fetchSignalHireContacts("Acme", "secret", request, "India");

    expect(result).toMatchObject({ status: "ok", creditsRemaining: "17" });
    expect(result.candidates).toEqual([expect.objectContaining({
      name: "Jane Recruiter",
      title: "Technical Recruiter",
      location: "Bengaluru, India",
      providerPersonId: "u1",
      contactStatus: "not_requested",
      source: "signalhire",
    })]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ currentCompany: "Acme", location: "India", size: 25 });
  });

  it("resolves only the explicitly selected profile", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([{ item: "u1", status: "success", candidate: {
      fullName: "Jane Recruiter",
      locations: [{ name: "Bengaluru, India" }],
      contacts: [
        { type: "email", value: "jane@gmail.com", rating: 95, subType: "personal" },
        { type: "email", value: "Jane@Acme.com", rating: 85, subType: "work" },
        { type: "phone", value: "+1 555 0100", rating: 90 },
      ],
      social: [{ type: "li", link: "https://linkedin.com/in/jane", rating: 100 }],
      experience: [{ position: "Technical Recruiter", company: "Acme", current: true }],
    } }]), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await resolveSignalHireContact("secret", { providerPersonId: "u1", name: "Jane Recruiter" }, request);

    expect(result).toMatchObject({ email: "jane@acme.com", phone: "+1 555 0100", linkedinUrl: "https://linkedin.com/in/jane", location: "Bengaluru, India", contactStatus: "resolved" });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ items: ["u1"], withoutWaterfall: true });
  });

  it("reports credit exhaustion without throwing or exposing the key", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("quota", { status: 402 }));
    const result = await fetchSignalHireContacts("Acme", "super-secret-key", request);
    expect(result.candidates).toEqual([]);
    expect(result.status).toBe("quota_exhausted");
    expect(result.error).toContain("credits");
    expect(result.error).not.toContain("super-secret-key");
  });
});
