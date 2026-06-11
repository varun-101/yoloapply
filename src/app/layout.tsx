import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeToggle } from "@/components/theme-toggle";
import { RailNav, MobileNav } from "@/components/nav";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Applies the saved (or system) theme before first paint to avoid a light
// flash. Must be inline in <head> — anything bundle-loaded runs too late.
const THEME_INIT = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`;

export const metadata: Metadata = {
  title: "YOLOapply",
  description: "Auto-apply to jobs with AI-tailored LaTeX resumes and cold email outreach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Outbound mail goes through Gmail SMTP (mailer.ts), so show that account —
  // OWNER_EMAIL is the resume's Outlook address, not the sender.
  const ownerEmail = process.env.SMTP_USER ?? "varunchandwani101@gmail.com";
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="flex min-h-screen flex-col md:flex-row">
          {/* The rail stays night-dark in both themes — the agent works the
              night shift even when the workspace is in daylight. */}
          <aside className="hidden md:flex w-60 shrink-0 flex-col sticky top-0 h-screen bg-slate-950 border-r border-slate-800 dark:border-slate-900">
            <div className="px-5 pt-5 pb-4 border-b border-white/10">
              <Link
                href="/"
                className="group flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 rounded-md"
              >
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-signal font-display text-sm font-bold text-slate-950">
                  Y
                </div>
                <div>
                  <div className="font-display text-[15px] font-semibold tracking-tight text-white">
                    YOLOapply
                  </div>
                  <div className="font-mono text-[10px] text-slate-500">night-shift job agent</div>
                </div>
              </Link>
            </div>

            <RailNav />

            <div className="border-t border-white/10 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
                </span>
                <span className="text-xs font-medium text-slate-200">Agent on watch</span>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-slate-500">
                sweeps the boards every 3h
                <br />
                nothing sends without your review
              </p>
              <p className="font-mono text-[10px] text-slate-500 truncate" title={ownerEmail}>
                from <span className="text-slate-300">{ownerEmail}</span>
              </p>
              <ThemeToggle />
            </div>
          </aside>

          {/* Small screens: the rail folds into a top strip. */}
          <header className="md:hidden sticky top-0 z-40 bg-slate-950 border-b border-slate-800">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <Link href="/" className="flex items-center gap-2">
                <div className="grid h-6 w-6 place-items-center rounded-md bg-signal font-display text-xs font-bold text-slate-950">
                  Y
                </div>
                <span className="font-display text-sm font-semibold text-white">YOLOapply</span>
              </Link>
              <ThemeToggle compact />
            </div>
            <MobileNav />
          </header>

          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
