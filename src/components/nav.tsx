"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  FileText,
  LayoutDashboard,
  Mail,
  PlusCircle,
  Radar,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  icon: LucideIcon;
  label: string;
}

interface Section {
  label: string;
  items: Item[];
}

// Sections mirror how the work actually divides: the agent operates, you
// manage the pipeline, outreach is its own track, assets back it all.
const SECTIONS: Section[] = [
  {
    label: "Operate",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/discover", icon: Radar, label: "Discover" },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { href: "/applications", icon: Briefcase, label: "Applications" },
      { href: "/applications/new", icon: PlusCircle, label: "New application" },
    ],
  },
  {
    label: "Outreach",
    items: [
      { href: "/cold-email", icon: Mail, label: "Cold outreach" },
      { href: "/contacts", icon: Users, label: "Contacts" },
    ],
  },
  {
    label: "Assets",
    items: [
      { href: "/resume", icon: FileText, label: "Generic resume" },
      { href: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

// The Admin section is only shown to admins (the shared catalog is theirs to run).
const ADMIN_SECTION: Section = {
  label: "Admin",
  items: [{ href: "/admin", icon: Shield, label: "Admin panel" }],
};

function sectionsFor(isAdmin: boolean): Section[] {
  return isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;
}

const ALL_ITEMS = [...SECTIONS, ADMIN_SECTION].flatMap((s) => s.items);

// Longest matching href wins, so /applications/new highlights "New
// application" rather than "Applications".
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of ALL_ITEMS) {
    const matches = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

export function RailNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {sectionsFor(isAdmin).map((section) => (
        <div key={section.label}>
          <div className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
            {section.label}
          </div>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const isActive = item.href === active;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70",
                    isActive
                      ? "bg-white/[0.06] text-signal"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-signal" />
                  )}
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// Compact horizontal strip for small screens — same destinations, no sections.
export function MobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const items = sectionsFor(isAdmin).flatMap((s) => s.items);
  return (
    <nav className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
      {items.map((item) => {
        const isActive = item.href === active;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70",
              isActive
                ? "bg-white/[0.06] text-signal"
                : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
