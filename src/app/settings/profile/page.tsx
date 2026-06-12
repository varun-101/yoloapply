"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

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

const EMPTY_EDUCATION: Education = { degree: "", school: "", cgpa: "", grad: "" };

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
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

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

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
          </Field>
          <Field label="Contact email" hint="Printed on the resume — can differ from your login email.">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." />
          </Field>
          <Field label="Years of experience">
            <Input value={yoe} onChange={(e) => setYoe(e.target.value)} placeholder="0.5" />
          </Field>
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mumbai" />
          </Field>
          <Field label="Country">
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="India" />
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
          <CardTitle>Education</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Degree">
            <Input
              value={education.degree}
              onChange={(e) => setEducation({ ...education, degree: e.target.value })}
              placeholder="B.E. Computer Engineering"
            />
          </Field>
          <Field label="School">
            <Input
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
