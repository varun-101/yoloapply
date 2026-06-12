"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Circle, X } from "lucide-react";
import type { SetupStatus } from "@/lib/setup";

const ITEMS: { key: keyof Omit<SetupStatus, "complete">; label: string; href: string; why: string }[] = [
  { key: "profile", label: "Fill in your profile", href: "/settings/profile", why: "resumes & cold emails need your identity" },
  { key: "projects", label: "Add at least one project", href: "/settings/projects", why: "personalization only uses real projects" },
  { key: "search", label: "Set your locations", href: "/settings/search", why: "discovery filters postings by where you can work" },
  { key: "llmKey", label: "Add your DeepSeek API key", href: "/settings/credentials", why: "powers scoring, tailoring and drafting" },
  { key: "smtp", label: "Configure outbound email", href: "/settings/credentials", why: "cold emails send from your own address" },
  { key: "genericResume", label: "Upload a generic resume", href: "/resume", why: "the fallback attachment for cold emails" },
];

const DISMISS_KEY = "yolo-setup-dismissed";

export function SetupChecklist({ status }: { status: SetupStatus }) {
  const [dismissed, setDismissed] = useState(true); // avoid a flash before localStorage is read

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (status.complete || dismissed) return null;
  const done = ITEMS.filter((i) => status[i.key]).length;

  return (
    <Card className="mb-8 border-signal/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-800 dark:text-signal mb-0.5">
              Finish setup · {done}/{ITEMS.length}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              The agent works from your data — a few pieces are still missing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {}
              setDismissed(true);
            }}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            aria-label="Dismiss setup checklist"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {ITEMS.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-sm">
              {status[item.key] ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Circle className="h-4 w-4 mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />
              )}
              <span className={status[item.key] ? "text-slate-400 dark:text-slate-500 line-through" : ""}>
                {status[item.key] ? (
                  item.label
                ) : (
                  <Link href={item.href} className="text-slate-700 dark:text-slate-200 hover:underline">
                    {item.label}
                  </Link>
                )}
                {!status[item.key] && (
                  <span className="block text-xs text-slate-400 dark:text-slate-500">{item.why}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
