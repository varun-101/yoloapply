import "./globals.css";
import Link from "next/link";
import { Briefcase, FileText, Mail, LayoutDashboard, PlusCircle, Radar, Users } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "YOLOapply",
  description: "Auto-apply to jobs with AI-tailored LaTeX resumes and cold email outreach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
            <div className="p-4 border-b border-slate-200">
              <Link href="/" className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-md bg-slate-900 text-white grid place-items-center text-sm font-bold">Y</div>
                <div>
                  <div className="text-sm font-semibold">YOLOapply</div>
                  <div className="text-xs text-slate-500">auto-apply agent</div>
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
            </nav>
            <div className="p-3 border-t border-slate-200 text-xs text-slate-500 absolute bottom-0 w-60">
              Sending from{" "}
              <span className="font-medium text-slate-700">{process.env.OWNER_EMAIL ?? "varunchandwani101@gmail.com"}</span>
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
      className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
