"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, FileUp, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import type { ResumeImportProfile } from "@/lib/resumeImport";

interface Education {
  degree: string;
  school: string;
  cgpa: string;
  grad: string;
}

interface Experience {
  title: string;
  company: string;
  period: string;
  location: string;
  bullets: string; // textarea — one bullet per line
}

interface Extra {
  title: string;
  org: string;
  period: string;
  summary: string;
}

interface ApplicationAnswers {
  workAuthorization: string;
  sponsorship: string;
  noticePeriod: string;
  willingToRelocate: string;
  currentLocation: string;
}

const EMPTY_EDUCATION: Education = { degree: "", school: "", cgpa: "", grad: "" };
const EMPTY_APPLICATION_ANSWERS: ApplicationAnswers = {
  workAuthorization: "",
  sponsorship: "",
  noticePeriod: "",
  willingToRelocate: "",
  currentLocation: "",
};

interface ImportInfo {
  filename: string;
  pages: number;
  filled: number;
}

interface MissingField {
  id: string;
  label: string;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

export default function ProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [yoe, setYoe] = useState("");
  const [github, setGithub] = useState("");
  const [githubHandle, setGithubHandle] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [linkedinHandle, setLinkedinHandle] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [education, setEducation] = useState<Education>(EMPTY_EDUCATION);
  const [experience, setExperience] = useState<Experience[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [applicationAnswers, setApplicationAnswers] = useState<ApplicationAnswers>(EMPTY_APPLICATION_ANSWERS);
  const [followUpDelayDays, setFollowUpDelayDays] = useState(5);
  const [recruiterLocation, setRecruiterLocation] = useState("");

  const missingFields = useMemo<MissingField[]>(() => {
    if (!importInfo) return [];
    const fields: Array<MissingField & { value: string }> = [
      { id: "profile-name", label: "Full name", value: name },
      { id: "profile-email", label: "Contact email", value: email },
      { id: "profile-phone", label: "Phone", value: phone },
      { id: "profile-years-experience", label: "Years of experience", value: yoe },
      { id: "profile-city", label: "City", value: city },
      { id: "profile-country", label: "Country", value: country },
      { id: "profile-current-location", label: "Current location", value: applicationAnswers.currentLocation },
      { id: "profile-notice-period", label: "Notice period", value: applicationAnswers.noticePeriod },
      { id: "profile-work-authorization", label: "Work authorization", value: applicationAnswers.workAuthorization },
      { id: "profile-sponsorship", label: "Sponsorship", value: applicationAnswers.sponsorship },
      { id: "profile-relocation", label: "Willing to relocate", value: applicationAnswers.willingToRelocate },
      { id: "profile-degree", label: "Degree", value: education.degree },
      { id: "profile-school", label: "School", value: education.school },
      { id: "profile-graduation", label: "Graduation", value: education.grad },
    ];
    return fields.filter((field) => !field.value.trim()).map(({ id, label }) => ({ id, label }));
  }, [applicationAnswers, city, country, education, email, importInfo, name, phone, yoe]);

  function attentionClass(id: string): string | undefined {
    return missingFields.some((field) => field.id === id)
      ? "border-amber-400 bg-amber-50/60 focus:border-amber-500 focus:ring-amber-500 dark:border-amber-700 dark:bg-amber-950/20"
      : undefined;
  }

  useEffect(() => {
    fetch("/api/settings/profile")
      .then((r) => r.json())
      .then((d) => {
        const p = d.profile;
        if (!p) return;
        setName(p.name ?? "");
        setEmail(p.email ?? "");
        setPhone(p.phone ?? "");
        setCity(p.city ?? "");
        setCountry(p.country ?? "");
        setYoe(p.yearsOfExperience ?? "");
        setGithub(p.github ?? "");
        setGithubHandle(p.githubHandle ?? "");
        setLinkedin(p.linkedin ?? "");
        setLinkedinHandle(p.linkedinHandle ?? "");
        setPortfolio(p.portfolio ?? "");
        setEducation({
          degree: p.education?.degree ?? "",
          school: p.education?.school ?? "",
          cgpa: p.education?.cgpa ?? "",
          grad: p.education?.grad ?? "",
        });
        setExperience(
          (Array.isArray(p.experience) ? p.experience : []).map(
            (e: { title?: string; company?: string; period?: string; location?: string; bullets?: string[] }) => ({
              title: e.title ?? "",
              company: e.company ?? "",
              period: e.period ?? "",
              location: e.location ?? "",
              bullets: (e.bullets ?? []).join("\n"),
            })
          )
        );
        setExtras(
          (Array.isArray(p.extras) ? p.extras : []).map(
            (x: { title?: string; org?: string; period?: string; summary?: string }) => ({
              title: x.title ?? "",
              org: x.org ?? "",
              period: x.period ?? "",
              summary: x.summary ?? "",
            })
          )
        );
        setApplicationAnswers({
          workAuthorization: p.applicationAnswers?.workAuthorization ?? "",
          sponsorship: p.applicationAnswers?.sponsorship ?? "",
          noticePeriod: p.applicationAnswers?.noticePeriod ?? "",
          willingToRelocate: p.applicationAnswers?.willingToRelocate ?? "",
          currentLocation: p.applicationAnswers?.currentLocation ?? "",
        });
        setFollowUpDelayDays(Math.min(30, Math.max(1, Number(p.followUpDelayDays) || 5)));
        setRecruiterLocation(p.recruiterLocation ?? "");
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function importResume() {
    if (!resumeFile) return;
    setImporting(true);
    setErr(null);
    setSaved(false);
    setImportInfo(null);
    try {
      const form = new FormData();
      form.set("file", resumeFile);
      const response = await fetch("/api/settings/profile/import-resume", { method: "POST", body: form });
      const data = (await response.json()) as {
        profile?: ResumeImportProfile;
        pages?: number;
        error?: string;
      };
      if (!response.ok || !data.profile) throw new Error(data.error ?? "Resume import failed");

      const imported = data.profile;
      const choose = (current: string, candidate: string) => current.trim() ? current : candidate.trim();
      const importedExperience: Experience[] = imported.experience.map((entry) => ({
        title: entry.title,
        company: entry.company,
        period: entry.period,
        location: entry.location,
        bullets: entry.bullets.join("\n"),
      }));
      const importedExtras: Extra[] = imported.extras.map((entry) => ({
        title: entry.title,
        org: entry.org,
        period: entry.period,
        summary: entry.summary,
      }));
      const importedLocation = [imported.city, imported.country].filter(Boolean).join(", ");

      const scalarPairs: Array<[string, string]> = [
        [name, imported.name],
        [email, imported.email],
        [phone, imported.phone],
        [city, imported.city],
        [country, imported.country],
        [yoe, imported.yearsOfExperience],
        [github, imported.github],
        [githubHandle, imported.githubHandle],
        [linkedin, imported.linkedin],
        [linkedinHandle, imported.linkedinHandle],
        [portfolio, imported.portfolio],
        [education.degree, imported.education?.degree ?? ""],
        [education.school, imported.education?.school ?? ""],
        [education.cgpa, imported.education?.cgpa ?? ""],
        [education.grad, imported.education?.grad ?? ""],
        [applicationAnswers.currentLocation, importedLocation],
      ];
      let filled = scalarPairs.filter(([current, candidate]) => !current.trim() && candidate.trim()).length;
      if (experience.length === 0 && importedExperience.length > 0) filled += 1;
      if (extras.length === 0 && importedExtras.length > 0) filled += 1;

      setName((current) => choose(current, imported.name));
      setEmail((current) => choose(current, imported.email));
      setPhone((current) => choose(current, imported.phone));
      setCity((current) => choose(current, imported.city));
      setCountry((current) => choose(current, imported.country));
      setYoe((current) => choose(current, imported.yearsOfExperience));
      setGithub((current) => choose(current, imported.github));
      setGithubHandle((current) => choose(current, imported.githubHandle));
      setLinkedin((current) => choose(current, imported.linkedin));
      setLinkedinHandle((current) => choose(current, imported.linkedinHandle));
      setPortfolio((current) => choose(current, imported.portfolio));
      setEducation((current) => ({
        degree: choose(current.degree, imported.education?.degree ?? ""),
        school: choose(current.school, imported.education?.school ?? ""),
        cgpa: choose(current.cgpa, imported.education?.cgpa ?? ""),
        grad: choose(current.grad, imported.education?.grad ?? ""),
      }));
      setExperience((current) => current.length > 0 ? current : importedExperience);
      setExtras((current) => current.length > 0 ? current : importedExtras);
      setApplicationAnswers((current) => ({
        ...current,
        currentLocation: choose(current.currentLocation, importedLocation),
      }));
      setImportInfo({ filename: resumeFile.name, pages: data.pages ?? 0, filled });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  function focusMissingField(id: string) {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => element?.focus(), 350);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          city,
          country,
          yearsOfExperience: yoe,
          github,
          githubHandle,
          linkedin,
          linkedinHandle,
          portfolio,
          education:
            education.degree || education.school
              ? {
                  degree: education.degree,
                  school: education.school,
                  cgpa: education.cgpa || undefined,
                  grad: education.grad || undefined,
                }
              : null,
          experience: experience
            .filter((e) => e.title || e.company)
            .map((e) => ({
              title: e.title,
              company: e.company,
              period: e.period,
              location: e.location || undefined,
              bullets: e.bullets.split("\n").map((b) => b.trim()).filter(Boolean),
            })),
          extras: extras
            .filter((x) => x.title || x.org)
            .map((x) => ({
              title: x.title,
              org: x.org,
              period: x.period || undefined,
              summary: x.summary || undefined,
            })),
          applicationAnswers,
          followUpDelayDays,
          recruiterLocation,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSaved(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-400 dark:text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin inline" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
          {err}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          Profile saved.
        </div>
      )}

      <Card className="border-signal/30 bg-signal/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-signal-deep dark:text-signal" />
            Import profile from resume
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Upload a text-based PDF and AI will fill the empty fields below. Existing profile data is preserved,
            and nothing is saved until you review it and select <span className="font-medium">Save profile</span>.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="file"
              accept="application/pdf,.pdf"
              disabled={importing}
              onChange={(event) => {
                setResumeFile(event.target.files?.[0] ?? null);
                setImportInfo(null);
                setErr(null);
              }}
              className="file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
            />
            <Button onClick={importResume} disabled={!resumeFile || importing} className="w-full shrink-0 sm:w-auto">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {importing ? "Reading resume…" : "Fill profile"}
            </Button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Resume text is sent to your configured AI provider for extraction and is not stored by this import.
            It does not replace your generic resume or infer work authorization, sponsorship, notice period, or
            relocation preferences.
          </p>
        </CardContent>
      </Card>

      {importInfo && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            missingFields.length
              ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          <div className="flex items-start gap-2">
            {missingFields.length ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div>
              <div className="font-medium">
                Filled {importInfo.filled} empty field{importInfo.filled === 1 ? "" : "s"} from {importInfo.filename}
                {importInfo.pages ? ` (${importInfo.pages} page${importInfo.pages === 1 ? "" : "s"})` : ""}.
              </div>
              {missingFields.length ? (
                <>
                  <p className="mt-1 text-xs opacity-80">Please complete these before saving:</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {missingFields.map((field) => (
                      <button
                        key={field.id}
                        type="button"
                        onClick={() => focusMissingField(field.id)}
                        className="rounded-full border border-amber-300 bg-white/70 px-2 py-1 text-xs hover:bg-white dark:border-amber-800 dark:bg-amber-950/50 dark:hover:bg-amber-950"
                      >
                        {field.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs opacity-80">Everything essential is filled. Review the draft, then save it.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Full name">
            <Input id="profile-name" className={attentionClass("profile-name")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
          </Field>
          <Field label="Contact email" hint="Printed on the resume — can differ from your login email.">
            <Input id="profile-email" className={attentionClass("profile-email")} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Phone">
            <Input id="profile-phone" className={attentionClass("profile-phone")} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." />
          </Field>
          <Field label="Years of experience">
            <Input id="profile-years-experience" className={attentionClass("profile-years-experience")} value={yoe} onChange={(e) => setYoe(e.target.value)} placeholder="0.5" />
          </Field>
          <Field label="City">
            <Input id="profile-city" className={attentionClass("profile-city")} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" />
          </Field>
          <Field label="Country">
            <Input id="profile-country" className={attentionClass("profile-country")} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="India" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Links</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="GitHub URL">
            <Input value={github} onChange={(e) => setGithub(e.target.value)} placeholder="https://github.com/you" />
          </Field>
          <Field label="GitHub handle">
            <Input value={githubHandle} onChange={(e) => setGithubHandle(e.target.value)} placeholder="you" />
          </Field>
          <Field label="LinkedIn URL">
            <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/you" />
          </Field>
          <Field label="LinkedIn handle">
            <Input value={linkedinHandle} onChange={(e) => setLinkedinHandle(e.target.value)} placeholder="you" />
          </Field>
          <Field label="Portfolio URL">
            <Input value={portfolio} onChange={(e) => setPortfolio(e.target.value)} placeholder="https://you.dev" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Application answers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            These values are reused only when you enter them explicitly. Missing answers stay empty and require review.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Current location">
              <Input
                id="profile-current-location"
                className={attentionClass("profile-current-location")}
                value={applicationAnswers.currentLocation}
                onChange={(e) => setApplicationAnswers({ ...applicationAnswers, currentLocation: e.target.value })}
                placeholder="Mumbai, India"
              />
            </Field>
            <Field label="Notice period">
              <Input
                id="profile-notice-period"
                className={attentionClass("profile-notice-period")}
                value={applicationAnswers.noticePeriod}
                onChange={(e) => setApplicationAnswers({ ...applicationAnswers, noticePeriod: e.target.value })}
                placeholder="Immediate / 30 days"
              />
            </Field>
            <Field label="Work authorization">
              <Input
                id="profile-work-authorization"
                className={attentionClass("profile-work-authorization")}
                value={applicationAnswers.workAuthorization}
                onChange={(e) => setApplicationAnswers({ ...applicationAnswers, workAuthorization: e.target.value })}
                placeholder="Your exact answer"
              />
            </Field>
            <Field label="Sponsorship">
              <Input
                id="profile-sponsorship"
                className={attentionClass("profile-sponsorship")}
                value={applicationAnswers.sponsorship}
                onChange={(e) => setApplicationAnswers({ ...applicationAnswers, sponsorship: e.target.value })}
                placeholder="Your exact answer"
              />
            </Field>
            <Field label="Willing to relocate">
              <Input
                id="profile-relocation"
                className={attentionClass("profile-relocation")}
                value={applicationAnswers.willingToRelocate}
                onChange={(e) => setApplicationAnswers({ ...applicationAnswers, willingToRelocate: e.target.value })}
                placeholder="Yes / No / Depends on location"
              />
            </Field>
            <Field label="Outreach follow-up delay" hint="A reviewable follow-up is scheduled after initial outreach; it is never sent automatically.">
              <Input
                type="number"
                min={1}
                max={30}
                value={followUpDelayDays}
                onChange={(e) => setFollowUpDelayDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
              />
            </Field>
            <Field
              label="Preferred recruiter location"
              hint="Used to prioritize recruiters near your target market, for example India or Bengaluru, India."
            >
              <Input
                value={recruiterLocation}
                onChange={(e) => setRecruiterLocation(e.target.value)}
                placeholder="India"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Education</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Degree">
            <Input
              id="profile-degree"
              className={attentionClass("profile-degree")}
              value={education.degree}
              onChange={(e) => setEducation({ ...education, degree: e.target.value })}
              placeholder="B.E. Computer Engineering"
            />
          </Field>
          <Field label="School">
            <Input
              id="profile-school"
              className={attentionClass("profile-school")}
              value={education.school}
              onChange={(e) => setEducation({ ...education, school: e.target.value })}
              placeholder="University name"
            />
          </Field>
          <Field label="CGPA / grade">
            <Input
              value={education.cgpa}
              onChange={(e) => setEducation({ ...education, cgpa: e.target.value })}
              placeholder="8.5"
            />
          </Field>
          <Field label="Graduation">
            <Input
              id="profile-graduation"
              className={attentionClass("profile-graduation")}
              value={education.grad}
              onChange={(e) => setEducation({ ...education, grad: e.target.value })}
              placeholder="2026"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Experience</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setExperience([...experience, { title: "", company: "", period: "", location: "", bullets: "" }])
            }
          >
            <Plus className="h-4 w-4" /> Add entry
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {experience.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No experience entries yet — fine for a fresher; the resume section is skipped.
            </p>
          )}
          {experience.map((exp, i) => (
            <div key={i} className="rounded-md border border-slate-200 dark:border-slate-800 p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Title">
                  <Input
                    value={exp.title}
                    onChange={(e) =>
                      setExperience(experience.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                    }
                    placeholder="Backend Intern"
                  />
                </Field>
                <Field label="Company">
                  <Input
                    value={exp.company}
                    onChange={(e) =>
                      setExperience(experience.map((x, j) => (j === i ? { ...x, company: e.target.value } : x)))
                    }
                    placeholder="Acme Corp"
                  />
                </Field>
                <Field label="Period">
                  <Input
                    value={exp.period}
                    onChange={(e) =>
                      setExperience(experience.map((x, j) => (j === i ? { ...x, period: e.target.value } : x)))
                    }
                    placeholder="Jun 2025 – Aug 2025"
                  />
                </Field>
                <Field label="Location">
                  <Input
                    value={exp.location}
                    onChange={(e) =>
                      setExperience(experience.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)))
                    }
                    placeholder="Remote"
                  />
                </Field>
              </div>
              <Field label="Bullets" hint="One per line — these are the default resume bullets; personalization may tailor them per JD.">
                <Textarea
                  value={exp.bullets}
                  onChange={(e) =>
                    setExperience(experience.map((x, j) => (j === i ? { ...x, bullets: e.target.value } : x)))
                  }
                  rows={4}
                />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => setExperience(experience.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Extras</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExtras([...extras, { title: "", org: "", period: "", summary: "" }])}
          >
            <Plus className="h-4 w-4" /> Add entry
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {extras.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Hackathons, leadership, certifications — optional resume garnish.
            </p>
          )}
          {extras.map((x, i) => (
            <div key={i} className="rounded-md border border-slate-200 dark:border-slate-800 p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Title">
                  <Input
                    value={x.title}
                    onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))}
                    placeholder="Hackathon winner"
                  />
                </Field>
                <Field label="Organization">
                  <Input
                    value={x.org}
                    onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, org: e.target.value } : y)))}
                    placeholder="HackX"
                  />
                </Field>
                <Field label="Period">
                  <Input
                    value={x.period}
                    onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, period: e.target.value } : y)))}
                    placeholder="2025"
                  />
                </Field>
              </div>
              <Field label="Summary">
                <Textarea
                  value={x.summary}
                  onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, summary: e.target.value } : y)))}
                  rows={2}
                />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !name || !email}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save profile
        </Button>
      </div>
    </div>
  );
}
