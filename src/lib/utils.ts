import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function statusColor(s: string): string {
  switch (s) {
    case "draft": return "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
    case "personalized": return "bg-violet-100 dark:bg-violet-950 text-violet-800 dark:text-violet-300";
    case "applied": return "bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300";
    case "replied": return "bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300";
    case "interview": return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300";
    case "offer": return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300";
    case "rejected": return "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300";
    case "closed": return "bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-500";
    default: return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
  }
}

// Solid swatches for the pipeline distribution bar — same hue per status as
// the badges above.
export function statusBarColor(s: string): string {
  switch (s) {
    case "draft": return "bg-slate-300 dark:bg-slate-600";
    case "personalized": return "bg-violet-400";
    case "applied": return "bg-sky-400";
    case "replied": return "bg-purple-400";
    case "interview": return "bg-amber-400";
    case "offer": return "bg-emerald-400";
    case "rejected": return "bg-rose-400";
    case "closed": return "bg-slate-400 dark:bg-slate-500";
    default: return "bg-slate-300 dark:bg-slate-600";
  }
}
