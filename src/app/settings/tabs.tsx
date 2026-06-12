"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { KeyRound, Search, FolderGit2, UserRound, type LucideIcon } from "lucide-react";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/settings/profile", label: "Profile", icon: UserRound },
  { href: "/settings/projects", label: "Projects", icon: FolderGit2 },
  { href: "/settings/search", label: "Search", icon: Search },
  { href: "/settings/credentials", label: "Credentials", icon: KeyRound },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800 mb-6 overflow-x-auto">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 rounded-t-md",
              active
                ? "border-signal text-slate-900 dark:text-slate-100 font-medium"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
