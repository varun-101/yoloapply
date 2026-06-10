# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YOLOapply is a personal AI job-application agent for Varun (final-year CE student, Mumbai, backend/Java+Node). It discovers fresher/junior postings, fit-scores them, personalizes a LaTeX resume per JD, drafts cold emails to founders, semi-auto-applies via Playwright, and tracks every application. Single-user, runs locally on Windows.

## Commands

```powershell
npm run dev          # Next.js on http://localhost:3001 (NOT 3000)
npm run build        # production build
npm run discover     # headless discovery scan (same as the dashboard "Scan now" button)
npm run db:push      # prisma db push (see schema-change gotcha below)
npm run db:studio    # browse the SQLite DB
npx tsc --noEmit     # typecheck — no test suite exists
npx tsx scripts/seed-ats-companies.ts   # re-seed ATS watchlist from data/ats-companies/probe-results.json
npx tsx scripts/probe-ats-companies.ts  # re-probe all ~10k boards in the dataset (~5 min), then re-seed
```

- One-off scripts: write to `scripts/*.ts`, run with `npx tsx`, start with `try { process.loadEnvFile(".env") } catch {}`.
- Known pre-existing tsc errors (don't fix unless asked, don't count as new breakage): `scripts/auto-apply.ts`, `src/app/api/resume/file/route.ts`, `src/lib/onePage.ts`.
- A Windows Task Scheduler entry ("YOLOapply Discover") runs `npm run discover` every 3 hours.

## Hard constraints

- **LLM is DeepSeek, never Anthropic/OpenAI cloud** — `src/lib/llm.ts` uses the OpenAI SDK pointed at `api.deepseek.com` (`deepseek-chat`). Varun pays for DeepSeek. New LLM features go through `chatJson` in `llm.ts`.
- **No fabricated resume facts.** Personalization/cold-email prompts may only draw on `src/lib/owner.ts` (identity/experience) and `src/lib/projects.ts` (curated project bank, sourced from `D:\portfolio\src\constants.ts` — the portfolio, not GitHub, is the source of truth for projects).
- **Outbound email** sends via Gmail SMTP from `varunchandwani101@gmail.com` (nodemailer, `src/lib/mailer.ts`) — not the Outlook address printed on the resume.
- **Never auto-submit applications or mass-email.** Playwright prefills and stops for human review; cold emails are drafted one at a time.

## Architecture

Next.js 14 App Router. Pages under `src/app/**` are client components fetching `src/app/api/**` route handlers; all business logic lives in `src/lib/**`. Prisma + SQLite at `prisma/dev.db`.

### Schema-change gotcha (recurring trap)

`src/lib/db.ts` caches `PrismaClient` on `globalThis`, so it survives HMR — and the running dev server locks the Prisma engine DLL. After editing `prisma/schema.prisma`: **stop the dev server, then `npx prisma db push`, then restart**. Otherwise you get `EPERM ... query_engine-windows.dll.node` during generate and `Cannot read properties of undefined (reading 'findMany')` for new models at runtime. Same restart rule applies to `tailwind.config.ts` changes.

### Discovery pipeline (`src/lib/discovery/`)

`runDiscovery()` in `pipeline.ts` is the single entry (dashboard route and `scripts/discover.ts` both call it):

1. Fetches all sources in parallel: `sheet.ts` (community freshers XLSX, tier 1), `jobfound.ts` (Hygraph GraphQL, tier 1), `ats.ts` (tier 2), `hn.ts` (monthly "Who is hiring", LLM-extracted, tier 3, often yields founder emails for cold outreach). Tiers in `types.ts` drive default queue ordering.
2. `ats.ts` scans ~1,020 companies from the **`AtsCompany` table** (not hardcoded) via official unauthenticated Greenhouse/Lever/Ashby board APIs — concurrency pool of 12, 20s timeouts. Self-maintaining: 5 consecutive failures → `active=false`; per-board yield tracked in `lastMatchAt`/`totalMatches`. Greenhouse JDs are fetched per-job, only for new title+location-matched postings (capped 25/board) — never board-wide `content=true`. The table was seeded from the kalil0321/ats-scrapers dataset filtered to boards with ≥1 India posting (`data/ats-companies/`).
3. Title/location keyword filters in `config.ts` apply only to non-curated sources (ATS, HN).
4. Dedupe: per-source `source::externalId`, then cross-source by canonicalized URL (tracking params stripped; extra source appended to `JobLead.sources`), then skip anything matching an existing Application.
5. Each run is recorded as a **`ScanRun`** (trigger "dashboard" | "script", per-source stats JSON, errors) and created leads carry `scanRunId` — this powers `/discover/history`. A module-level lock makes concurrent `runDiscovery()` calls join the in-flight run; P2002 on insert is counted as a duplicate (cross-process race with the scheduled task).
6. `score.ts` fit-scores new leads 0–100 via DeepSeek, capped at 45/run to bound cost — a big scan backlog drains over subsequent runs.

Sources can partially fail (a few boards down) — UI and script report counts plus a partial-error note; only `fetched === 0` is a real failure.

### Application flow

Lead promote (or manual entry) → `Application` row → `personalize.ts` (DeepSeek picks 3-4 projects, tailors bullets to the JD) → `latex.ts` (typed LaTeX builder, ATS-friendly template) → `compile.ts` (remote texlive.net / latex.ytotech.com, local `tectonic`/`pdflatex` if installed) → PDF under `storage/`. `onePage.ts` enforces one-page output. Status changes and emails append `Event` rows (timeline on the application page).

### Chrome extension (`extension/`)

Standalone vanilla-JS extension; nothing is bundled into or imported from the Next.js app. It calls the app's API with the `EXTENSION_API_KEY` shared secret (`.env` + extension options). Backend support for it (CORS, auth, `/api/extract-job/dom`, `/api/autofill-map`, `/api/answer-question`, `/api/profile`) lives in the main app.

## UI conventions

- Tailwind with `darkMode: "class"`. Every hardcoded color utility must carry a `dark:` twin (convention: `bg-white`→`dark:bg-slate-900`, `bg-slate-50`→`dark:bg-slate-950`, `text-slate-500`→`dark:text-slate-400`, badge tints `*-100/*-800`→`dark:*-950/dark:*-300`). Theme is applied pre-paint by an inline script in `layout.tsx`; the toggle is `src/components/theme-toggle.tsx`.
- shadcn-style primitives in `src/components/ui/` (button/card/badge/input) with `cn()` from `src/lib/utils.ts`.

## Environment (`.env`)

`DEEPSEEK_API_KEY` (scoring/personalization skip gracefully without it), `SMTP_USER`/`SMTP_PASS` (Gmail app password), `EXTENSION_API_KEY`, `DATABASE_URL` (`file:./dev.db`).
