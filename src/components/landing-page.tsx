"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  ArrowRight,
  Eye,
  FileText,
  Gauge,
  KeyRound,
  Mail,
  Radar,
  ShieldCheck,
} from "lucide-react";

// Public landing page. An always-night marketing surface (the brand works the
// night shift) that narrates one overnight pass and ends at dawn. Dark in both
// themes by design — same exception the app's sidebar rail makes.

const LOG: { t: string; m: string; tone?: "agent" }[] = [
  { t: "23:58", m: "agent on watch", tone: "agent" },
  { t: "00:11", m: "sweeping greenhouse · lever · ashby" },
  { t: "00:12", m: "found · backend engineer, seed-stage fintech" },
  { t: "00:12", m: "fit 88 · matches your stack", tone: "agent" },
  { t: "00:19", m: "résumé rebuilt around the job description" },
  { t: "00:24", m: "cold email drafted to the founder" },
  { t: "00:24", m: "holding for your review", tone: "agent" },
];

const PIPELINE = [
  {
    icon: Radar,
    title: "Discover",
    body: "Sweeps fresh boards and community lists for early-career roles worth your time.",
  },
  {
    icon: Gauge,
    title: "Score fit",
    body: "Reads each posting against your profile and rates how closely it matches.",
  },
  {
    icon: FileText,
    title: "Tailor",
    body: "Rebuilds your résumé in LaTeX around the exact wording of the job description.",
  },
  {
    icon: Mail,
    title: "Draft outreach",
    body: "Writes a cold email to the founder, grounded in your own work — never invented.",
  },
  {
    icon: Eye,
    title: "Hold for review",
    body: "Queues everything and stops. You read it, then decide what actually sends.",
  },
];

const PRINCIPLES = [
  {
    icon: KeyRound,
    title: "Your keys, your account",
    body: "Runs on your own model and email credentials, encrypted at rest. Never a shared sender.",
  },
  {
    icon: Eye,
    title: "Nothing sends without you",
    body: "The agent prepares; you approve. It never auto-submits an application or mass-mails.",
  },
  {
    icon: ShieldCheck,
    title: "No invented facts",
    body: "Résumés and emails draw only from the profile and projects you enter. Nothing fabricated.",
  },
];

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Arm scroll-reveal only after mount, so non-JS visitors keep content.
    root.classList.add("lp-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("lp-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="lp min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-signal selection:text-slate-950">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 md:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-signal font-display text-sm font-bold text-slate-950">
              Y
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight">YOLOapply</span>
          </Link>
          <nav className="flex items-center gap-1.5 sm:gap-3">
            <Link
              href="/sign-in"
              className="rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-1.5 rounded-md bg-signal px-3.5 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ffc14d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
            >
              Start <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="lp-aurora pointer-events-none absolute inset-0" />
        <div className="lp-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-16 md:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28 lg:pt-24">
          <div>
            <div className="lp-load inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal" />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
                night-shift job agent
              </span>
            </div>

            <h1
              className="lp-load mt-6 font-display text-5xl font-semibold leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl"
              style={{ animationDelay: "0.08s" }}
            >
              Sleep through
              <br />
              the job hunt.
            </h1>

            <p
              className="lp-load mt-6 max-w-xl text-lg leading-relaxed text-slate-400"
              style={{ animationDelay: "0.16s" }}
            >
              YOLOapply works the boards overnight — scoring each early-career role for fit, tailoring
              your résumé to the posting, and drafting the cold email. Every move waits for your
              sign-off before it goes anywhere.
            </p>

            <div className="lp-load mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: "0.24s" }}>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-md bg-signal px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ffc14d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
              >
                Start the night shift <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-md border border-white/12 px-5 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-white/25 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
              >
                Sign in
              </Link>
            </div>
          </div>

          {/* Signature: the agent's overnight log. */}
          <div className="lp-load lg:justify-self-end" style={{ animationDelay: "0.2s" }}>
            <AgentLog />
          </div>
        </div>
      </section>

      {/* ── Pipeline: a real, ordered sequence ── */}
      <section className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-28">
        <div data-reveal className="max-w-2xl">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
            what happens while you&apos;re out
          </div>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Five moves, one decision.
          </h2>
          <p className="mt-3 text-slate-400">
            The agent runs the whole loop end to end, then steps back. The last move is always yours.
          </p>
        </div>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.04] sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                data-reveal
                style={{ transitionDelay: `${i * 70}ms` }}
                className="group relative bg-slate-950 p-6 lg:p-7"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-signal">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-xs text-slate-600 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{step.body}</p>
              </li>
            );
          })}
          {/* Trailing cell keeps the grid whole and restates the promise. */}
          <li
            data-reveal
            style={{ transitionDelay: `${PIPELINE.length * 70}ms` }}
            className="flex flex-col justify-center gap-2 bg-gradient-to-br from-signal/[0.12] to-transparent p-6 lg:p-7"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal/90">
              and then it waits
            </span>
            <p className="text-sm leading-relaxed text-slate-300">
              No surprises in your sent folder. You wake up to a queue, not a mess.
            </p>
          </li>
        </ol>
      </section>

      {/* ── Principles / trust ── */}
      <section className="border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-28">
          <div data-reveal className="max-w-2xl">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
              on your terms
            </div>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Built to stay yours.
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PRINCIPLES.map((p, i) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  data-reveal
                  style={{ transitionDelay: `${i * 80}ms` }}
                  className="rounded-xl border border-white/[0.08] bg-slate-950 p-7"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-signal">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-display text-lg font-semibold">{p.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{p.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Dawn: closing CTA ── */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 120% at 50% 130%, rgba(255,178,36,0.22), rgba(185,122,0,0.06) 38%, transparent 64%)",
          }}
        />
        <div data-reveal className="relative mx-auto max-w-3xl px-5 py-24 text-center md:px-8 lg:py-32">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal/80">morning</div>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Clock in tonight.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-400">
            Add your profile, drop in your keys, and hand the grind to the agent. Review what it
            prepares over your morning coffee.
          </p>
          <div className="mt-9 flex justify-center">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-md bg-signal px-6 py-3.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#ffc14d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
            >
              Start the night shift <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-center md:flex-row md:px-8 md:text-left">
          <div className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-signal font-display text-xs font-bold text-slate-950">
              Y
            </span>
            <span className="font-mono text-[11px] text-slate-500">night-shift job agent</span>
          </div>
          <Link href="/sign-in" className="font-mono text-[11px] text-slate-500 transition-colors hover:text-slate-300">
            sign in →
          </Link>
        </div>
      </footer>
    </div>
  );
}

function AgentLog() {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur-sm">
      {/* Title bar with the same sweep the live scanner uses. */}
      <div className="relative flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">
          agent · tonight&apos;s pass
        </span>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <span className="absolute h-full w-1/4 animate-sweep rounded-full bg-signal/70" />
        </span>
      </div>

      <div className="space-y-2.5 p-4 font-mono text-[12.5px] leading-relaxed sm:text-[13px]">
        {LOG.map((line, i) => (
          <div
            key={i}
            className="lp-line flex items-start gap-3"
            style={{ animationDelay: `${0.15 + i * 0.13}s` }}
          >
            <span className="shrink-0 text-slate-600 tabular-nums">{line.t}</span>
            <span className={line.tone === "agent" ? "text-signal" : "text-slate-300"}>
              {line.m}
            </span>
          </div>
        ))}
        <div
          className="lp-line flex items-center gap-3 pt-1"
          style={{ animationDelay: `${0.15 + LOG.length * 0.13}s` }}
        >
          <span className="shrink-0 text-slate-600 tabular-nums">{LOG[LOG.length - 1].t}</span>
          <span className="lp-cursor inline-block h-3.5 w-2 bg-signal/80" aria-hidden />
        </div>
      </div>
    </div>
  );
}
