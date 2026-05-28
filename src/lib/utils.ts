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
    case "draft": return "bg-slate-200 text-slate-800";
    case "personalized": return "bg-indigo-100 text-indigo-800";
    case "applied": return "bg-blue-100 text-blue-800";
    case "replied": return "bg-purple-100 text-purple-800";
    case "interview": return "bg-amber-100 text-amber-800";
    case "offer": return "bg-emerald-100 text-emerald-800";
    case "rejected": return "bg-rose-100 text-rose-800";
    case "closed": return "bg-slate-100 text-slate-600";
    default: return "bg-slate-100 text-slate-700";
  }
}
