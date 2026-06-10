import "./globals.css";
import Link from "next/link";
import { Briefcase, FileText, Mail, LayoutDashboard, PlusCircle, Radar, Users } from "lucide-react";
import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";

// Applies the saved (or system) theme before first paint to avoid a light
// flash. Must be inline in <head> — anything bundle-loaded runs too late.
const THEME_INIT = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`;

export const metadata: Metadata = {
  title: "YOLOapply",
  description: "Auto-apply to jobs with AI-tailored LaTeX resumes and cold email outreach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <Link href="/" className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 grid place-items-center text-sm font-bold">Y</div>
                <div>
                  <div className="text-sm font-semibold">YOLOapply</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">auto-apply agent</div>
                </div>
              </Link>
            </div>
            <nav className="p-2 text-sm">
              <NavItem href="/" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
              <NavItem href="/discover" icon={<Radar className="h-4 w-4" />} label="Discover" />
              <NavItem href="/applications/new" icon={<PlusCircle className="h-4 w-4" />} label="New Application" />
              <NavItem href="/applications" icon={<Briefcase className="h-4 w-4" />} label="Applications" />
              <NavItem href="/cold-email" icon={<Mail className="h-4 w-4" />} label="Cold Outreach" />
              <NavItem href="/contacts" icon={<Users className="h-4 w-4" />} label="Contacts" />
              <NavItem href="/resume" icon={<FileText className="h-4 w-4" />} label="Generic Resume" />
              <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <ThemeToggle />
              </div>
            </nav>
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 absolute bottom-0 w-60">
              Sending from{" "}
              <span className="font-medium text-slate-700 dark:text-slate-300">{process.env.OWNER_EMAIL ?? "varunchandwani101@gmail.com"}</span>
            </div>
          </aside>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}

function NavItem({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
