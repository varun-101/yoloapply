"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  KeyRound,
  Search,
  FolderGit2,
  UserRound,
  PenLine,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/settings/profile", label: "Profile", icon: UserRound },
  { href: "/settings/projects", label: "Projects", icon: FolderGit2 },
  { href: "/settings/search", label: "Search", icon: Search },
  { href: "/settings/prompts", label: "Writing", icon: PenLine },
  { href: "/settings/credentials", label: "Credentials", icon: KeyRound },
  { href: "/settings/app", label: "App", icon: Smartphone },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    // Phones get every tab at once as an even grid — scrolling them
    // horizontally pushed "Credentials" off the edge, so the tab you most
    // often want was the one you couldn't see. Three columns (two rows of
    // three) keeps "Credentials" readable at 390px; icons drop out to buy the
    // room.
    <nav className="grid grid-cols-3 gap-1 border-b border-slate-200 dark:border-slate-800 mb-6 sm:flex sm:overflow-x-auto">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex min-h-[2.75rem] items-center justify-center gap-1.5 px-1 py-2 text-[13px] border-b-2 -mb-px transition-colors",
              "sm:shrink-0 sm:justify-start sm:px-3 sm:text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 rounded-t-md",
              active
                ? "border-signal text-slate-900 dark:text-slate-100 font-medium"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            )}
          >
            <Icon className="hidden h-3.5 w-3.5 sm:block" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
