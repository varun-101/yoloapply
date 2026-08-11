import "./globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { ClerkProvider, SignedIn, SignOutButton, UserButton } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
import { currentUser } from "@clerk/nextjs/server";
import { ThemeToggle } from "@/components/theme-toggle";
import { RailNav, BottomNav } from "@/components/nav";
import { RegisterSW } from "@/components/pwa/register-sw";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { clerkAppearance } from "@/lib/clerkAppearance";
import { prisma } from "@/lib/db";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Applies the saved (or system) theme before first paint to avoid a light
// flash. Must be inline in <head> — anything bundle-loaded runs too late.
const THEME_INIT = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`;

export const metadata: Metadata = {
  title: "YOLOapply",
  description: "Auto-apply to jobs with AI-tailored LaTeX resumes and cold email outreach.",
  applicationName: "YOLOapply",
  // Home-screen install (see src/app/manifest.ts — Next links the manifest
  // automatically). iOS ignores the manifest for these two, hence the
  // apple-specific block and the apple-touch-icon.
  appleWebApp: {
    capable: true,
    title: "YOLOapply",
    // "default" keeps the status bar opaque and legible in both themes;
    // black-translucent would put content under the clock.
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Fills the notch/rounded corners; the safe-area insets in globals.css keep
  // content clear of them. No maximum-scale — pinch zoom stays available.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0F1E" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  const isAdmin = user
    ? (await prisma.user.findUnique({ where: { clerkId: user.id }, select: { isAdmin: true } }))
        ?.isAdmin ?? false
    : false;
  return (
    <ClerkProvider appearance={clerkAppearance}>
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <RegisterSW />
        {/* Offered once signed in — installing is about fast access to the
            pipeline, not to the marketing page. */}
        {user && <InstallPrompt />}
        <div className="flex min-h-screen flex-col md:flex-row">
          {/* App chrome only for signed-in users — signed-out visitors get the
              full-bleed landing page (and the sign-in/up screens) with no rail.
              Gated on the server-resolved user so it doesn't pop in. */}
          {user && (
          <>
          {/* The rail follows the theme: light surface in daylight, night-dark
              when the workspace is dark. */}
          <aside className="hidden md:flex w-60 shrink-0 flex-col sticky top-0 h-screen bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-900">
            <div className="px-5 pt-5 pb-4 border-b border-slate-200 dark:border-white/10">
              <Link
                href="/"
                className="group flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 rounded-md"
              >
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-signal font-display text-sm font-bold text-slate-950">
                  Y
                </div>
                <div>
                  <div className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
                    YOLOapply
                  </div>
                  <div className="font-mono text-[10px] text-slate-500">night-shift job agent</div>
                </div>
              </Link>
            </div>

            <RailNav isAdmin={isAdmin} />

            <div className="border-t border-slate-200 dark:border-white/10 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
                </span>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Agent on watch</span>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-slate-500">
                sweeps the boards every 3h
                <br />
                nothing sends without your review
              </p>
              <SignedIn>
                <div className="flex items-center gap-2 min-w-0">
                  <UserButton afterSignOutUrl="/sign-in" />
                  {email && (
                    <span className="truncate font-mono text-[10px] text-slate-500" title={email}>
                      {email}
                    </span>
                  )}
                </div>
                <SignOutButton redirectUrl="/sign-in">
                  <button className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70">
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </SignOutButton>
              </SignedIn>
              <ThemeToggle />
            </div>
          </aside>

          {/* Small screens: the rail folds into a top strip. */}
          {/* Small screens: a slim identity bar up top, destinations live in
              the bottom tab bar. Installed on iOS this strip sits under the
              clock, so it carries the top inset itself (0 in a browser tab). */}
          <header className="md:hidden sticky top-0 z-40 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 pt-[env(safe-area-inset-top)]">
            <div className="flex items-center justify-between px-4 py-2.5">
              <Link href="/" className="flex items-center gap-2">
                <div className="grid h-6 w-6 place-items-center rounded-md bg-signal font-display text-xs font-bold text-slate-950">
                  Y
                </div>
                <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">YOLOapply</span>
              </Link>
              <div className="flex items-center gap-3">
                <SignedIn>
                  <UserButton afterSignOutUrl="/sign-in" />
                </SignedIn>
                <ThemeToggle compact />
              </div>
            </div>
          </header>

          <BottomNav isAdmin={isAdmin} email={email} />
          </>
          )}

          {/* Bottom padding clears the fixed tab bar (plus the home indicator);
              on md+ the bar is gone and so is the padding. */}
          <main
            className={`flex-1 min-w-0 ${user ? "pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0" : ""}`}
          >
            {children}
          </main>
        </div>
      </body>
    </html>
    </ClerkProvider>
  );
}
