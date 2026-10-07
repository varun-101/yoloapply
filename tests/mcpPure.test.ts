import { describe, expect, it } from "vitest";
import {
  ApplicationIndex,
  companyRoleKey,
  describeSalary,
  experienceFits,
  jdQualityOf,
  parseExperienceRange,
  postingKey,
} from "@/lib/mcp/jobIdentity";
import { decodeCursor, encodeCursor, filterHash, type JobSearchFilters } from "@/lib/mcp/jobSearch";
import { readDeclarationDefaults, resolveDeclarations, sameOrganization } from "@/lib/mcp/declarations";
import { chooseOption, reviewFields } from "@/lib/mcp/formReview";
import { classifyMessage, matchApplications, matchConfidence, type MailMessage } from "@/lib/mcp/mail/classify";
import { extractCodes, selectOtp } from "@/lib/mcp/mail/otp";
import { deriveSubmissionState, resolveAppliedAt, validateEvidence } from "@/lib/application-agent/submission";
import { mergeFormAnswers, type CandidateProfile } from "@/lib/profile";
import { jsonResult, toToolError, withTimeout } from "@/lib/mcp/server";
import { ApiUserError } from "@/lib/auth";

describe("postingKey", () => {
  it("identifies the same Greenhouse posting across board hosts", () => {
    expect(postingKey("https://boards.greenhouse.io/acme/jobs/6200261004?gh_src=x")).toBe("greenhouse:6200261004");
    expect(postingKey("https://job-boards.greenhouse.io/acme/jobs/6200261004")).toBe("greenhouse:6200261004");
    expect(postingKey("https://acme.com/careers?gh_jid=6200261004")).toBe("greenhouse:6200261004");
  });
  it("ignores Lever /apply and Ashby /application suffixes", () => {
    const uuid = "4524ca30-d006-48bc-81c2-cec58e1bb331";
    expect(postingKey(`https://jobs.lever.co/h1/${uuid}/apply`)).toBe(postingKey(`https://jobs.lever.co/h1/${uuid}`));
    expect(postingKey(`https://jobs.ashbyhq.com/b/${uuid}/application`)).toBe(`ashby:${uuid}`);
  });
  it("falls back to the canonical URL", () => {
    expect(postingKey("https://www.example.com/jobs/1?utm_source=x")).toBe("url:https://example.com/jobs/1");
    expect(postingKey("not a url")).toBeNull();
  });
});

describe("experience and salary", () => {
  it("parses common experience formats", () => {
    expect(parseExperienceRange("0-2 years")).toEqual({ min: 0, max: 2 });
    expect(parseExperienceRange("3+ yrs")).toEqual({ min: 3, max: null });
    expect(parseExperienceRange("Fresher")).toEqual({ min: 0, max: 1 });
    expect(parseExperienceRange("minimum 5 years")).toEqual({ min: 5, max: null });
    expect(parseExperienceRange("0 - 1")).toEqual({ min: 0, max: 1 });
    expect(parseExperienceRange("")).toBeNull();
  });
  it("keeps unknown experience unless known is required", () => {
    expect(experienceFits(null, 1)).toBe(true);
    expect(experienceFits(null, 1, true)).toBe(false);
    expect(experienceFits("3-5 years", 1)).toBe(false);
    expect(experienceFits("1-3 years", 1)).toBe(true);
  });
  it("never claims a salary is verified", () => {
    expect(describeSalary("INR 30,000-50,000 / month")).toMatchObject({ disclosed: true, verified: false });
    expect(describeSalary(null)).toMatchObject({ disclosed: false, verified: false, listedText: null });
    expect(describeSalary("Not disclosed").disclosed).toBe(false);
  });
  it("flags thin or heading-only descriptions", () => {
    expect(jdQualityOf(0, "")).toBe("missing");
    expect(jdQualityOf(300, "short")).toBe("thin");
    expect(jdQualityOf(2000, "About us\nResponsibilities\nRequirements\nBenefits")).toBe("thin");
    expect(jdQualityOf(2000, "We are hiring a backend engineer who will design and build reliable services for payments at scale.")).toBe("present");
  });
});

describe("ApplicationIndex", () => {
  const index = new ApplicationIndex([
    {
      id: "a1",
      company: "Acme Pvt Ltd",
      role: "Software Engineer - I",
      status: "applied",
      appliedAt: new Date("2026-09-01T00:00:00Z"),
      createdAt: new Date("2026-09-01T00:00:00Z"),
      jdUrl: "https://jobs.lever.co/acme/4524ca30-d006-48bc-81c2-cec58e1bb331",
      applyUrl: null,
      canonicalUrl: null,
    },
  ]);
  it("matches by posting id across URL variants", () => {
    const m = index.match({ urls: ["https://jobs.lever.co/acme/4524ca30-d006-48bc-81c2-cec58e1bb331/apply?lever-source=x"] });
    expect(m).toHaveLength(1);
    expect(["canonical_url", "posting_id"]).toContain(m[0].reason);
  });
  it("matches by normalized company and role", () => {
    expect(companyRoleKey("ACME", "software engineer I")).toBe("acme|software engineer i");
    expect(index.match({ company: "Acme", role: "Software Engineer I" })[0]?.reason).toBe("company_role");
    expect(index.match({ company: "Acme", role: "Data Engineer" })).toHaveLength(0);
  });
});

describe("search cursors", () => {
  const filters: JobSearchFilters = {
    status: "new",
    includeUnknownLocation: false,
    requireKnownExperience: false,
    requireDescription: false,
    duplicatePolicy: "exclude",
    sort: "recent",
    locations: ["Pune"],
  };
  it("round-trips and rejects a cursor from different filters", () => {
    const hash = filterHash(filters);
    const cursor = encodeCursor({ v: 1, f: hash, at: "2026-10-01T00:00:00.000Z", id: "x" });
    expect(decodeCursor(cursor, hash).id).toBe("x");
    expect(() => decodeCursor(cursor, filterHash({ ...filters, locations: ["Mumbai"] }))).toThrow(/different filters/);
    expect(() => decodeCursor("garbage", hash)).toThrow(/Invalid cursor/);
  });
});

const profile: CandidateProfile = {
  userId: "u",
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "+91 98765 43210",
  github: "https://github.com/asha",
  githubHandle: "asha",
  linkedin: "https://www.linkedin.com/in/asha",
  linkedinHandle: "asha",
  portfolio: "",
  city: "Pune",
  country: "India",
  yearsOfExperience: "1",
  education: { degree: "B.E. Computer Engineering", school: "Example Institute of Technology", grad: "2026" },
  experience: [{ title: "Intern", company: "Loan for India", period: "2025-2026", bullets: [] }],
  extras: [],
  applicationAnswers: { currentLocation: "Pune, India", noticePeriod: "Immediate" },
  followUpDelayDays: 5,
  recruiterLocation: "",
};

const savedDefaults = readDeclarationDefaults({
  declarationDefaults: {
    priorEmploymentAtHiringCompany: {
      answer: "No",
      confirmedAt: "2026-10-07",
      confirmedBy: "candidate",
      knownPastOrganizations: ["DataCurve"],
    },
    relativeInGovernment: { answer: "No", confirmedAt: "2026-10-07", confirmedBy: "candidate" },
  },
});

describe("declaration defaults", () => {
  it("are absent unless the candidate saved them", () => {
    const resolved = resolveDeclarations({ defaults: {}, experienceCompanies: [], company: "Acme" });
    expect(resolved.every((d) => d.status === "unknown" && d.answer === null)).toBe(true);
    expect(readDeclarationDefaults({ declarationDefaults: { relativeInGovernment: { answer: "Yes" } } })).toEqual({});
  });
  it("answer No for an unrelated company", () => {
    const resolved = resolveDeclarations({ defaults: savedDefaults, experienceCompanies: ["Loan for India"], company: "Acme" });
    expect(resolved.map((d) => [d.key, d.status, d.answer])).toEqual([
      ["priorEmploymentAtHiringCompany", "answer", "No"],
      ["relativeInGovernment", "answer", "No"],
    ]);
  });
  it("defer to known history for past employers and clients", () => {
    for (const company of ["Loan For India Pvt Ltd", "DataCurve", "DataCurve AI"]) {
      const d = resolveDeclarations({ defaults: savedDefaults, experienceCompanies: ["Loan for India"], company })[0];
      expect(d.status).toBe("known_relationship");
      expect(d.answer).toBeNull();
    }
    expect(sameOrganization("Data", "DataCurve")).toBe(false);
  });
});

describe("review_form_fields", () => {
  const review = (fields: Parameters<typeof reviewFields>[0]["fields"], company = "Acme") =>
    reviewFields({ fields, profile, declarationDefaults: savedDefaults, company });

  it("separates displayed from persisted values", () => {
    const [shownOnly, persisted] = review([
      { label: "Email", displayedValue: "asha@example.com" },
      { label: "Email", displayedValue: "asha@example.com", persistedValue: "asha@example.com" },
    ]);
    expect(shownOnly.verdict).toBe("ok_unverified");
    expect(persisted.verdict).toBe("ok");
  });
  it("flags parser substitutions and empty fields", () => {
    const [phone, location, notice] = review([
      { label: "Phone", displayedValue: "9876543210" },
      { label: "Location", displayedValue: "Mumbai" },
      { label: "Notice period", displayedValue: "" },
    ]);
    expect(phone.verdict).toBe("ok_unverified");
    expect(location.verdict).toBe("correct");
    expect(location.expected).toBe("Pune, India");
    expect(notice.verdict).toBe("fill");
  });
  it("picks only real options and never invents one", () => {
    expect(chooseOption(["Example Institute of Technology, Pune", "Other"], "Example Institute of Technology")).toBe(
      "Example Institute of Technology, Pune"
    );
    const [school] = review([{ label: "School", fieldType: "select", options: ["University of Somewhere", "Other"] }]);
    expect(school.verdict).toBe("no_matching_option");
    expect(school.option).toBeUndefined();
  });
  it("applies saved declarations but not to other legal questions", () => {
    const [prior, gov, age, crim, freeText] = review([
      { label: "Have you previously worked for Acme or its subsidiaries?", required: true },
      { label: "Is any relative of yours a government official?", required: true },
      { label: "Are you at least 18 years of age?", required: true },
      { label: "Have you ever been convicted of a criminal offense?", required: true },
      { label: "Describe your experience with distributed systems", required: true },
    ]);
    expect(prior).toMatchObject({ verdict: "fill", expected: "No" });
    expect(gov).toMatchObject({ verdict: "fill", expected: "No" });
    expect(age.verdict).toBe("ask_candidate");
    expect(crim.verdict).toBe("review_sensitive");
    expect(freeText.verdict).toBe("ask_candidate");
  });
  it("does not default prior employment for a known past employer", () => {
    const [prior] = review([{ label: "Have you ever worked for Loan for India before?" }], "Loan for India");
    expect(prior.verdict).toBe("ask_candidate");
  });
  it("treats current employer as candidate-owned", () => {
    expect(review([{ label: "Current company", displayedValue: "Loan for India" }])[0].verdict).toBe("ask_candidate");
  });
});

const now = new Date("2026-10-07T10:00:00Z");
function msg(partial: Partial<MailMessage>): MailMessage {
  return {
    id: partial.id ?? "m" + Math.random().toString(36).slice(2),
    subject: "",
    fromAddress: "no-reply@greenhouse.io",
    fromName: "Acme Hiring",
    toAddresses: ["candidate@outlook.com"],
    receivedAt: "2026-10-07T09:58:00Z",
    preview: "",
    ...partial,
  };
}

describe("mail classification", () => {
  it("distinguishes receipts, rejections, duplicates and marketing", () => {
    expect(classifyMessage(msg({ subject: "Thank you for applying to Acme" }))).toBe("application_receipt");
    expect(classifyMessage(msg({ subject: "Your application to Acme", preview: "Unfortunately we will not be moving forward." }))).toBe("rejection");
    expect(classifyMessage(msg({ subject: "Acme application", preview: "It looks like you have already applied for this role." }))).toBe("duplicate_notice");
    expect(classifyMessage(msg({ subject: "50% off this weekend", preview: "unsubscribe", fromAddress: "deals@shop.com" }))).toBe("marketing");
    expect(classifyMessage(msg({ subject: "Your OTP for transaction", preview: "OTP 123456 for your debit card", fromAddress: "alerts@bank.com" }))).toBe("account_security");
  });
  it("matches application by company and reports ambiguity", () => {
    const apps = [
      { id: "a1", company: "Acme", role: "Backend Engineer", status: "applied", createdAt: new Date("2026-10-01"), appliedAt: null },
      { id: "a2", company: "Acme", role: "Frontend Engineer", status: "applied", createdAt: new Date("2026-10-01"), appliedAt: null },
      { id: "a3", company: "Globex", role: "Backend Engineer", status: "applied", createdAt: new Date("2026-10-01"), appliedAt: null },
    ];
    const generic = matchApplications(msg({ subject: "Thank you for applying to Acme" }), apps);
    expect(generic.map((m) => m.applicationId).sort()).toEqual(["a1", "a2"]);
    expect(matchConfidence(generic)).toBe("ambiguous");
    const specific = matchApplications(msg({ subject: "Thank you for applying to Acme: Backend Engineer" }), apps);
    expect(specific[0].applicationId).toBe("a1");
    expect(matchConfidence(specific)).toBe("single");
  });
});

describe("OTP selection", () => {
  const policy = {
    company: "Acme",
    applicationId: "a1",
    requestedAt: new Date("2026-10-07T09:57:00Z"),
    now,
    maxAgeMs: 15 * 60_000,
    recipients: ["candidate@outlook.com"],
    employerDomains: ["job-boards.greenhouse.io"],
  };
  const good = msg({ id: "good", subject: "Acme security code", preview: "Your security code is 482913. Use it to finish your application to Acme." });

  it("extracts labelled codes only", () => {
    expect(extractCodes("Your verification code is 482913.")).toEqual(["482913"]);
    expect(extractCodes("Copy this code:\n\n482913\n")).toContain("482913");
    expect(extractCodes("The code below expires soon")).toEqual([]);
  });
  it("returns the bound code with an expiry", () => {
    const r = selectOtp([good], policy);
    expect(r).toMatchObject({ kind: "code", code: "482913", messageId: "good" });
  });
  it("rejects stale, misaddressed, other-employer and bank codes", () => {
    const stale = msg({ ...good, id: "stale", receivedAt: "2026-10-07T09:40:00Z" });
    const misaddressed = msg({ ...good, id: "mis", toAddresses: ["someone@else.com"] });
    const other = msg({ id: "other", subject: "Globex security code", fromName: "Globex", preview: "Your security code is 111222 for Globex." });
    const bank = msg({ id: "bank", fromAddress: "alerts@bank.com", subject: "OTP", preview: "Your OTP is 999888 for a debit card transaction at Acme Store" });
    const r = selectOtp([stale, misaddressed, other, bank], policy);
    expect(r.kind).toBe("none");
    if (r.kind === "none") {
      expect(Object.fromEntries(r.rejected.map((x) => [x.messageId, x.reason]))).toMatchObject({
        stale: "outside_time_window",
        mis: "not_addressed_to_candidate_mailbox",
        other: "company_not_referenced",
        bank: "account_or_financial_security_message",
      });
    }
  });
  it("refuses conflicting codes arriving together", () => {
    const second = msg({ ...good, id: "second", preview: "Your security code is 777111 for Acme.", receivedAt: "2026-10-07T09:58:10Z" });
    expect(selectOtp([good, second], policy).kind).toBe("ambiguous");
  });
});

describe("submission evidence", () => {
  it("never moves appliedAt later and corrects to earlier evidence", () => {
    const existing = new Date("2026-10-07T00:00:00Z");
    expect(resolveAppliedAt(existing, new Date("2026-10-08T00:00:00Z"))).toEqual({ appliedAt: existing, corrected: false });
    const earlier = new Date("2026-09-01T00:00:00Z");
    expect(resolveAppliedAt(existing, earlier)).toEqual({ appliedAt: earlier, corrected: true });
  });
  it("requires concrete evidence per kind", () => {
    expect(() => validateEvidence({ evidenceKind: "site_confirmation", recordedBy: "agent" })).toThrow(ApiUserError);
    expect(() => validateEvidence({ evidenceKind: "employer_duplicate_notice", recordedBy: "agent", submittedAt: new Date("2026-09-01T00:00:00Z") })).toThrow(/ORIGINAL/);
    expect(() =>
      validateEvidence({ evidenceKind: "site_confirmation", recordedBy: "agent", confirmationText: "ok", submittedAt: new Date(Date.now() + 3_600_000) })
    ).toThrow(/future/);
    const at = validateEvidence({
      evidenceKind: "employer_duplicate_notice",
      recordedBy: "agent",
      submittedAt: new Date("2026-09-01T00:00:00Z"),
      submittedAtSource: "original receipt email",
    });
    expect(at.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
  it("never counts unknown outcomes as applied", () => {
    expect(deriveSubmissionState("personalized", [{ type: "SUBMISSION_UNCONFIRMED", createdAt: now }])).toBe("unconfirmed_attempt");
    expect(deriveSubmissionState("applied", [])).toBe("marked_applied_without_evidence");
    expect(deriveSubmissionState("applied", [{ type: "APPLICATION_SUBMITTED", createdAt: now }])).toBe("confirmed");
    expect(deriveSubmissionState("draft", [])).toBe("not_submitted");
  });
});

describe("profile answer merge", () => {
  it("keeps scoped answers the form does not edit", () => {
    const merged = mergeFormAnswers(
      { consentPreferences: { smsMessages: "yes" }, noticePeriod: "Immediate", declarationDefaults: { x: 1 } },
      { noticePeriod: "30 days", sponsorship: "" }
    ) as Record<string, unknown>;
    expect(merged).toEqual({ consentPreferences: { smsMessages: "yes" }, noticePeriod: "30 days", declarationDefaults: { x: 1 } });
    expect(mergeFormAnswers({ noticePeriod: "Immediate" }, undefined)).toEqual({ noticePeriod: "Immediate" });
  });
});

describe("tool result guards", () => {
  it("bounds output size", () => {
    const r = jsonResult("big", { s: "x".repeat(250_000) });
    expect(r.isError).toBe(true);
  });
  it("times out with an actionable message", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "slow_tool")).rejects.toThrow(/check status before retrying/);
  });
  it("does not leak internals in errors", () => {
    const r = toToolError(new Error("connect to postgresql://user:password@host failed"));
    expect(JSON.stringify(r)).not.toMatch(/password@/);
    const u = toToolError(new ApiUserError("Application not found.", 404, "not_found"));
    expect(JSON.parse((u.content[0] as { text: string }).text)).toEqual({ error: "Application not found.", code: "not_found" });
  });
});

describe("review regressions", () => {
  it("never labels rejections, alerts or promotions as receipts", async () => {
    const { classifyMessage: c } = await import("@/lib/mcp/mail/classify");
    const cases = [
      "Thank you for your interest in Acme. After careful review we will not be proceeding with your application.",
      "Thank you for your interest in Acme. We have decided to go in a different direction.",
      "Thanks for applying to Acme. Unfortunately we won't be moving forward.",
      "Thanks for your interest in our webinar on hiring",
      "Thank you for your interest in Acme roles! New jobs matching your profile are below.",
    ];
    for (const preview of cases) {
      expect(c({ subject: "Your application", preview, fromAddress: "no-reply@greenhouse.io" })).not.toBe("application_receipt");
    }
    expect(c({ subject: "Acme", preview: "Thank you for applying to Acme. We received your application.", fromAddress: "x@lever.co" })).toBe("application_receipt");
  });
  it("refuses account-recovery codes even from an ATS sender", () => {
    const r = selectOtp(
      [
        msg({
          id: "reset",
          fromAddress: "acme@myworkday.com",
          subject: "Reset your Acme candidate account password",
          preview: "Your verification code is 482913. Acme careers.",
        }),
      ],
      {
        company: "Acme",
        applicationId: "a1",
        requestedAt: new Date("2026-10-07T09:57:00Z"),
        now,
        maxAgeMs: 15 * 60_000,
        recipients: ["candidate@outlook.com"],
        employerDomains: [],
      }
    );
    expect(r.kind).toBe("none");
  });
  it("redacts codes in subjects and alphanumeric codes", async () => {
    const { redactCodes } = await import("@/lib/mcp/mail/otp");
    expect(redactCodes("123456 is your code")).not.toMatch(/123456/);
    expect(redactCodes("Your access code: AB12CD")).not.toMatch(/AB12CD/);
    expect(redactCodes("Use passcode X7Y8Z9 now")).not.toMatch(/X7Y8Z9/);
  });
  it("matches options on whole words", () => {
    expect(chooseOption(["Female", "Man"], "Male")).toBeNull();
    expect(chooseOption(["Male", "Female"], "Male")).toBe("Male");
  });
  it("requires a source for a late confirmation date", () => {
    expect(() =>
      validateEvidence({ evidenceKind: "site_confirmation", recordedBy: "agent", confirmationText: "ok", submittedAt: new Date(Date.now() - 3_600_000) })
    ).toThrow(/submittedAtSource/);
    expect(() =>
      validateEvidence({
        evidenceKind: "site_confirmation",
        recordedBy: "agent",
        confirmationText: "ok",
        submittedAt: new Date(Date.now() - 3_600_000),
        submittedAtSource: "thank-you page timestamp",
      })
    ).not.toThrow();
  });
});

describe("review round 2 regressions", () => {
  const gh = "no-reply@us.greenhouse-mail.io";
  it("treats every code form as code-bearing and redacts it", async () => {
    const { classifyMessage: c } = await import("@/lib/mcp/mail/classify");
    const { redactCodes } = await import("@/lib/mcp/mail/otp");
    const bodies = [
      ["Copy and paste this code into the security code field on your application to Acme: Ab3dEfGh", "Ab3dEfGh"],
      ["Your verification code is 482-913 for Acme", "482-913"],
      ["Enter 482 913 to confirm your email for Acme. This is your code.", "482 913"],
      ["Use code ab12cd to verify your email for Acme", "ab12cd"],
    ];
    for (const [preview, code] of bodies) {
      expect(c({ subject: "Acme application", preview, fromAddress: gh })).toBe("verification_code");
      expect(redactCodes(preview)).not.toContain(code);
      expect(extractCodes(preview)).toContain(code);
    }
  });
  it("does not read positive replies or polite receipts as rejections", async () => {
    const { classifyMessage: c } = await import("@/lib/mcp/mail/classify");
    expect(c({ subject: "Acme", preview: "We have decided to move forward with your application and would like to schedule an interview.", fromAddress: gh })).toBe(
      "interview_or_next_steps"
    );
    expect(c({ subject: "Acme", preview: "We received your application. Unfortunately we cannot reply to every applicant personally.", fromAddress: gh })).toBe(
      "application_receipt"
    );
    expect(c({ subject: "Acme", preview: "Unfortunately the role is closed.", fromAddress: gh })).toBe("rejection");
  });
  it("keeps receipts whose footer advertises jobs", async () => {
    const { classifyMessage: c } = await import("@/lib/mcp/mail/classify");
    const preview = "Thank you for applying to Acme. We received your application for Backend Engineer." + " x".repeat(250) + " Similar jobs you may like. 20% off promo code";
    expect(c({ subject: "Your application to Acme", preview, fromAddress: gh })).toBe("application_receipt");
  });
});

describe("review round 3 regressions", () => {
  const gh = "no-reply@us.greenhouse-mail.io";
  it("extracts letters-only, spaced and loosely worded codes", () => {
    expect(extractCodes("Copy and paste this code into the security code field on your application: kQbRtZxW")).toContain("kQbRtZxW");
    expect(extractCodes("Enter the following code to continue your application: 482913")).toContain("482913");
    expect(extractCodes("Your 6-digit code is 482913. It expires in 10 minutes.")).toContain("482913");
    expect(extractCodes("To finish, type 482913 on the application page. This code expires in 10 minutes.")).toContain("482913");
    expect(extractCodes("Your PIN is 4821")).toContain("4821");
    expect(extractCodes("Your verification code is 4 8 2 9 1 3")).toContain("4 8 2 9 1 3");
    expect(extractCodes("Please use the code below to continue")).toEqual([]);
  });
  it("classifies those as verification mail", async () => {
    const { classifyMessage: c } = await import("@/lib/mcp/mail/classify");
    expect(c({ subject: "Security code for your application to Acme", preview: "Copy and paste this code into the security code field on your application: kQbRtZxW", fromAddress: gh })).toBe(
      "verification_code"
    );
    expect(c({ subject: "Acme", preview: "Your PIN is 4821", fromAddress: gh })).toBe("verification_code");
  });
  it("reads 'moving forward with candidates' as a rejection", async () => {
    const { classifyMessage: c } = await import("@/lib/mcp/mail/classify");
    expect(
      c({ subject: "Acme", preview: "Thank you for applying. After careful review, we have decided to move forward with candidates whose experience more closely matches.", fromAddress: gh })
    ).toBe("rejection");
  });
});
