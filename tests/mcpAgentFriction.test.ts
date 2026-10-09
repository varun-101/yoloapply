import { describe, expect, it } from "vitest";
import { companyAliases, jdExperienceRequirement, jobExperienceFits, postingKey } from "@/lib/mcp/jobIdentity";
import { couldHaveRequestedCode } from "@/lib/mcp/mail/service";
import { matchApplications, type MailMessage } from "@/lib/mcp/mail/classify";
import { selectOtp } from "@/lib/mcp/mail/otp";
import { reviewFields, samePlace } from "@/lib/mcp/formReview";
import { answerKey, findSavedAnswer, readSavedAnswers } from "@/lib/mcp/savedAnswers";
import { atsPostingFromUrl } from "@/lib/discovery/liveness";
import { pendingQuestionsFrom } from "@/lib/mcp/applications";
import { playbook, playbookProviderFromUrl } from "@/lib/mcp/playbook";
import { isLoopback } from "@/lib/mcp/server";
import type { CandidateProfile } from "@/lib/profile";

// Fixes for what a real agent run hit: regional legal names in mail, listing
// experience bands, dead postings, re-asked questions and parked forms.

describe("company aliases", () => {
  it("strips legal and regional suffixes down to the name employers mail under", () => {
    expect(companyAliases("Qualcomm India Private Limited")).toEqual(["qualcomm india", "qualcomm"]);
    expect(companyAliases("Infosys Technologies Ltd")).toEqual(["infosys technologies", "infosys"]);
    expect(companyAliases("Acme")).toEqual(["acme"]);
  });
  it("never strips past a joiner or down to a generic word", () => {
    expect(companyAliases("Bank of India")).toEqual(["bank of india"]);
    expect(companyAliases("Global Services")).toEqual(["global services"]);
    expect(companyAliases("Cloud Solutions")).toEqual(["cloud solutions"]);
  });
});

const now = new Date("2026-10-09T05:00:00Z");
function msg(partial: Partial<MailMessage>): MailMessage {
  return {
    id: partial.id ?? "m1",
    subject: "",
    fromAddress: "confirm@eightfold.ai",
    fromName: "Qualcomm Careers",
    toAddresses: ["candidate@outlook.com"],
    receivedAt: "2026-10-09T04:59:00Z",
    preview: "",
    ...partial,
  };
}

describe("mail matching on the core company name", () => {
  const apps = [
    { id: "q", company: "Qualcomm India Private Limited", role: "Engineer, Associate", status: "draft", createdAt: new Date("2026-10-09"), appliedAt: null },
    { id: "g", company: "Globex", role: "SDE", status: "draft", createdAt: new Date("2026-10-09"), appliedAt: null },
  ];
  it("credits mail from 'Qualcomm Careers' to the Qualcomm India application", () => {
    const m = matchApplications(msg({ subject: "Verify your email", preview: "Your verification code is 482913" }), apps);
    expect(m.map((x) => x.applicationId)).toEqual(["q"]);
    expect(m[0].signals).toContain("company_in_sender_name");
  });
  it("releases the Eightfold code for that application only", () => {
    const code = msg({ subject: "Qualcomm Careers: verify your email", preview: "Your verification code is 482913. It expires in 10 minutes." });
    const policy = {
      company: "Qualcomm India Private Limited",
      applicationId: "q",
      requestedAt: new Date("2026-10-09T04:58:30Z"),
      now,
      maxAgeMs: 15 * 60_000,
      recipients: ["candidate@outlook.com"],
      employerDomains: ["careers.qualcomm.com"],
    };
    expect(selectOtp([code], policy)).toMatchObject({ kind: "code", code: "482913" });
    expect(selectOtp([code], { ...policy, company: "Globex", applicationId: "g" })).toMatchObject({ kind: "none" });
  });
});

describe("experience from the full description", () => {
  const jd = [
    "About us: founded 12 years ago, we have been in business for over 10 years.",
    "Requirements:",
    "- 3-6 years of experience building backend services.",
    "- 5+ years of experience with Go is a plus.",
  ].join("\n");
  it("reads the required years and ignores company age and preferred lines", () => {
    expect(jdExperienceRequirement(jd)).toMatchObject({ min: 3, max: 6 });
    expect(jdExperienceRequirement("Freshers welcome. 0-1 years of experience.")).toMatchObject({ min: 0, max: 1 });
    expect(jdExperienceRequirement("Great team, great perks.")).toBeNull();
  });
  it("takes the highest stated minimum, since every requirement must be met (run 2: Abnormal)", () => {
    const abnormal = "2+ years of experience as a software engineer with a strong foundation in coding.\n1+ years of hands-on experience in backend development using Python or Golang.";
    expect(jdExperienceRequirement(abnormal)).toMatchObject({ min: 2 });
    expect(jobExperienceFits(null, abnormal, 1)).toBe(false);
  });
  it("reads 'N years in <field>' without the word experience (run 2: Sarvam, rzr)", () => {
    expect(jdExperienceRequirement("• 3–6 years in backend engineering with production systems in continuous operation")).toMatchObject({ min: 3, max: 6 });
    expect(jdExperienceRequirement("We have worked with hundreds of advertisers over 14 years.")).toBeNull();
    expect(jdExperienceRequirement("Our founders have 20 years of experience in ad tech. 1+ years of experience with React.")).toMatchObject({ min: 1 });
  });
  it("lets the stricter of listing band and description decide", () => {
    expect(jobExperienceFits("0-1 years", jd, 1)).toBe(false); // NielsenIQ: listed 0, description 3-6
    expect(jobExperienceFits(null, jd, 3)).toBe(true);
    expect(jobExperienceFits(null, null, 1)).toBe(true);
    expect(jobExperienceFits(null, null, 1, true)).toBe(false);
  });
});

describe("posting identity on careers sites", () => {
  it("treats Eightfold-style /careers/job/<id> URLs with visit params as one posting (run 2: Qualcomm)", () => {
    const clean = postingKey("https://careers.qualcomm.com/careers/job/446718909932");
    expect(clean).toBe("careers_job:careers.qualcomm.com:446718909932");
    expect(postingKey("https://careers.qualcomm.com/careers/job/446718909932?hl=en-US&domain=qualcomm.com&source=jobfound.org")).toBe(clean);
    expect(postingKey("https://careers.qualcomm.com/careers/job/446721248684")).not.toBe(clean);
  });
});

describe("OTP attribution activity", () => {
  it("ignores a form that never opened", () => {
    expect(couldHaveRequestedCode({ stage: "form_opened", outcome: "blocked" })).toBe(false);
    expect(couldHaveRequestedCode({ stage: "form_opened", outcome: "failed" })).toBe(false);
    expect(couldHaveRequestedCode({ stage: "form_opened", outcome: "ok" })).toBe(true);
    expect(couldHaveRequestedCode({ stage: "submit_clicked", outcome: "blocked" })).toBe(true);
    expect(couldHaveRequestedCode(null)).toBe(true);
  });
});

describe("ATS posting URLs for liveness checks", () => {
  it("extracts board slug and id", () => {
    expect(atsPostingFromUrl("https://job-boards.greenhouse.io/acme/jobs/6200261004?gh_src=x")).toEqual({ ats: "greenhouse", slug: "acme", id: "6200261004" });
    expect(atsPostingFromUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=123")).toEqual({ ats: "greenhouse", slug: "acme", id: "123" });
    expect(atsPostingFromUrl("https://jobs.lever.co/netomi/4524ca30-d006-48bc-81c2-cec58e1bb331/apply")).toMatchObject({ ats: "lever", slug: "netomi" });
    expect(atsPostingFromUrl("https://jobs.eu.lever.co/x/4524ca30-d006-48bc-81c2-cec58e1bb331")).toMatchObject({ eu: true });
    expect(atsPostingFromUrl("https://jobs.ashbyhq.com/elevenlabs/0b3a97d4-193c-4b47-9888-7ef5803ed945")).toEqual({
      ats: "ashby",
      slug: "elevenlabs",
      id: "0b3a97d4-193c-4b47-9888-7ef5803ed945",
    });
  });
  it("does not guess for other boards", () => {
    expect(atsPostingFromUrl("https://careers.hpe.com/us/en/job/1211072/Cloud-Developer")).toBeNull();
    expect(atsPostingFromUrl("https://acme.com/careers?gh_jid=123")).toBeNull();
    expect(atsPostingFromUrl(null)).toBeNull();
  });
});

const profile: CandidateProfile = {
  userId: "u",
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "+91 98765 43210",
  github: "",
  githubHandle: "",
  linkedin: "",
  linkedinHandle: "",
  portfolio: "",
  city: "Pune",
  country: "India",
  yearsOfExperience: "1",
  education: null,
  experience: [],
  extras: [],
  applicationAnswers: {
    currentLocation: "Pune, India",
    savedAnswers: {
      currentSalary: {
        question: "Current annual CTC",
        answer: "INR 8,00,000",
        labels: ["Current CTC (INR)"],
        candidateStatement: "my current salary is 8 lakh a year",
        confirmedAt: "2026-10-09T05:00:00Z",
        confirmedBy: "candidate",
      },
      whyAcme: {
        question: "Why do you want to work at Acme?",
        answer: "Acme-specific answer",
        labels: [],
        company: "Acme Pvt Ltd",
        candidateStatement: "say I love their payments work",
        confirmedAt: "2026-10-09T05:00:00Z",
        confirmedBy: "candidate",
      },
      bogus: { answer: "x", confirmedBy: "agent" },
    },
  } as CandidateProfile["applicationAnswers"],
  followUpDelayDays: 5,
  recruiterLocation: "",
};

describe("review_form_fields with saved answers", () => {
  const review = (fields: Parameters<typeof reviewFields>[0]["fields"], company = "Acme") =>
    reviewFields({ fields, profile, declarationDefaults: {}, company });

  it("treats a city as matching its fuller form", () => {
    expect(samePlace("Pune", "Pune, India")).toBe(true);
    expect(samePlace("Pune, Maharashtra, India", "Pune")).toBe(true);
    expect(samePlace("Pune", "Mumbai, India")).toBe(false);
    expect(review([{ label: "City", displayedValue: "Pune" }])[0].verdict).toBe("ok_unverified");
  });
  it("recognises link fields however they are labelled, but not questions", () => {
    const withLinks = { ...profile, github: "https://github.com/asha", linkedin: "https://linkedin.com/in/asha" };
    const r = reviewFields({
      profile: withLinks,
      declarationDefaults: {},
      company: "Acme",
      fields: [
        { label: "GitHub URL (optional)", displayedValue: "" },
        { label: "LinkedIn Profile URL*", displayedValue: "linkedin.com/in/asha" },
        { label: "Your Github link", displayedValue: "" },
        { label: "Do you have a GitHub account?", displayedValue: "" },
      ],
    });
    expect(r.map((x) => x.verdict)).toEqual(["fill", "ok_unverified", "fill", "ask_candidate"]);
  });
  it("answers country from the profile", () => {
    expect(review([{ label: "Country", displayedValue: "" }])[0]).toMatchObject({ verdict: "fill", expected: "India" });
  });
  it("reuses a saved answer by label and only for its company when scoped", () => {
    const [ctc, why, whyOther] = [
      review([{ label: "Current CTC (INR)", displayedValue: "" }])[0],
      review([{ label: "Why do you want to work at Acme?", displayedValue: "" }])[0],
      review([{ label: "Why do you want to work at Acme?", displayedValue: "" }], "Globex")[0],
    ];
    expect(ctc).toMatchObject({ verdict: "fill", expected: "INR 8,00,000", factSource: "savedAnswers.currentSalary" });
    expect(why).toMatchObject({ verdict: "fill", factSource: "savedAnswers.whyAcme" });
    expect(whyOther.verdict).toBe("ask_candidate");
    expect(whyOther.reason).toMatch(/save_candidate_answer/);
  });
  it("only trusts entries the candidate confirmed", () => {
    const saved = readSavedAnswers(profile.applicationAnswers);
    expect(Object.keys(saved).sort()).toEqual(["currentSalary", "whyAcme"]);
    expect(findSavedAnswer(saved, "current ctc inr")?.key).toBe("currentSalary");
    expect(answerKey("Current CTC (INR)?")).toBe("currentCtcInr");
  });
});

describe("parked applications", () => {
  it("takes the latest input event", () => {
    const q = [{ label: "Notice period?" }];
    expect(
      pendingQuestionsFrom([
        { type: "CANDIDATE_INPUT_NEEDED", createdAt: new Date("2026-10-09T05:00:00Z"), metadata: { questions: q } },
      ])
    ).toEqual(q);
    expect(
      pendingQuestionsFrom([
        { type: "CANDIDATE_INPUT_NEEDED", createdAt: new Date("2026-10-09T05:00:00Z"), metadata: { questions: q } },
        { type: "CANDIDATE_INPUT_RESOLVED", createdAt: new Date("2026-10-09T05:10:00Z") },
      ])
    ).toEqual([]);
  });
});

describe("playbook and file delivery", () => {
  it("knows Eightfold and TurboHire", () => {
    expect(playbookProviderFromUrl("https://acme.eightfold.ai/careers/job/1")).toBe("eightfold");
    expect(playbook("turbohire").atsNotes.join(" ")).toMatch(/Next/);
    expect(playbook("unknown-ats").atsProvider).toBe("generic");
  });
  it("offers local files only to a same-machine server", () => {
    expect(isLoopback("http://localhost:3001")).toBe(true);
    expect(isLoopback("http://127.0.0.1:3001")).toBe(true);
    expect(isLoopback("http://[::1]:3001")).toBe(true);
    expect(isLoopback("https://yoloapply.up.railway.app")).toBe(false);
  });
});
