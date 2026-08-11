"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SignOutButton } from "@clerk/nextjs";
import {
  Briefcase,
  FileText,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  PlusCircle,
  Radar,
  Settings,
  Shield,
  TrendingUp,
  Users,
  X,
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
      { href: "/funding", icon: TrendingUp, label: "Funding" },
      { href: "/interview", icon: MessageSquareText, label: "Interview prep" },
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
                      ? "bg-slate-100 text-signal dark:bg-white/[0.06]"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-100"
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

// ---------------------------------------------------------------------------
// Small screens: a bottom tab bar, the convention every phone user already
// knows — thumb-reachable, fixed, and never scrolled away. The old top strip
// scrolled horizontally, which hid destinations off the right edge.
//
// Four tabs are the daily loop; everything else lives behind "More" so the bar
// never crowds. Tabs are the SAME hrefs as the rail, so `activeHref` still
// decides highlighting for both.
// ---------------------------------------------------------------------------

const TAB_HREFS = ["/", "/discover", "/applications", "/interview"];
const TABS: Item[] = [
  { href: "/", icon: LayoutDashboard, label: "Home" },
  { href: "/discover", icon: Radar, label: "Discover" },
  { href: "/applications", icon: Briefcase, label: "Pipeline" },
  { href: "/interview", icon: MessageSquareText, label: "Interview" },
];

export function BottomNav({ isAdmin = false, email }: { isAdmin?: boolean; email?: string }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const active = activeHref(pathname);
  // Anything not on a tab is reached through More — so More reads as active.
  const moreActive = active !== null && !TAB_HREFS.includes(active);

  // Route changes close the sheet (tapping a link inside it navigates).
  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch">
          {TABS.map((item) => {
            const isActive = item.href === active;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal/70",
                  isActive ? "text-signal" : "text-slate-500 dark:text-slate-400"
                )}
              >
                {isActive && (
                  <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-signal" />
                )}
                <Icon className="h-[1.15rem] w-[1.15rem] shrink-0" />
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              "relative flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal/70",
              moreActive ? "text-signal" : "text-slate-500 dark:text-slate-400"
            )}
          >
            {moreActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-signal" />}
            <MoreHorizontal className="h-[1.15rem] w-[1.15rem] shrink-0" />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && <MoreSheet isAdmin={isAdmin} email={email} onClose={() => setMoreOpen(false)} />}
    </>
  );
}

// Bottom sheet holding every destination that isn't a tab, grouped exactly like
// the desktop rail so the two navigations stay recognisably the same app.
function MoreSheet({
  isAdmin,
  email,
  onClose,
}: {
  isAdmin: boolean;
  email?: string;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const active = activeHref(pathname);

  // Escape closes; the body stays put so the page doesn't jump behind the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const sections = sectionsFor(isAdmin)
    .map((s) => ({ ...s, items: s.items.filter((i) => !TAB_HREFS.includes(i.href)) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-slate-950/50"
      />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[85vh] animate-sheet-up overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <span className="font-display text-base font-semibold">More</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-m-2 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-3 py-3">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
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
                      onClick={onClose}
                      className={cn(
                        "flex min-h-[2.75rem] items-center gap-3 rounded-md px-3 py-2.5 text-[15px]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70",
                        isActive
                          ? "bg-slate-100 text-signal dark:bg-white/[0.06]"
                          : "text-slate-700 dark:text-slate-300"
                      )}
                    >
                      <Icon className="h-[1.15rem] w-[1.15rem] shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="border-t border-slate-100 px-3 pt-3 dark:border-slate-800">
            {email && (
              <div className="truncate pb-2 font-mono text-[11px] text-slate-500" title={email}>
                {email}
              </div>
            )}
            <SignOutButton redirectUrl="/sign-in">
              <button className="flex min-h-[2.75rem] w-full items-center gap-3 rounded-md px-0 py-2.5 text-[15px] text-slate-700 dark:text-slate-300">
                <LogOut className="h-[1.15rem] w-[1.15rem]" />
                Sign out
              </button>
            </SignOutButton>
          </div>
        </div>
      </div>
    </div>
  );
}
