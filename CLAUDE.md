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

## Programming style — robust long-running operations

Every feature that triggers a non-trivial background task (discovery scans, resume generation, LLM scoring batches, email sends, etc.) **must** be implemented with the following guarantees from day one. Do not ship the happy path first and bolt these on later.

### 1. Backend owns the lifecycle — survive frontend disconnects

The backend must drive the task to completion regardless of what happens on the client side. If the browser tab is closed, the network drops, or the user navigates away, the task **must keep running** and its result must be retrievable later.

- Kick off work from the API route handler, but do not tie progress to the response stream being open.
- Persist task state (status, progress, result, error) in the database or an in-memory store keyed by a stable identifier so the frontend can poll or reconnect.

### 2. Idempotent retries — reject duplicate kicks, notify the caller

If the frontend (or scheduled task, or extension) calls the same long-running endpoint while a previous invocation is still in flight:

- **Do not start a second run.** Detect the in-flight task (via a module-level lock, DB status flag, or concurrency guard).
- **Return an informative response** (e.g., `{ status: "already_running", startedAt, progress }`) so the client can show appropriate UI ("Scan already in progress…") instead of silently queuing or erroring.
- The existing discovery pipeline's join-the-in-flight-run pattern (`runDiscovery` lock) is the reference implementation — replicate this approach for every new long-running feature.

### 3. Status & progress tracking

- Expose a lightweight status endpoint (or reuse the kick-off endpoint with GET) so the frontend can poll: `idle | running | completed | failed`, plus optional progress percentage and partial results.
- On completion or failure, persist the outcome so it is visible even if no client was listening at the time.

### 4. Frontend resilience

- The UI must handle the `already_running` response gracefully — show a banner/toast, disable the trigger button, and begin polling for progress.
- On page load or reconnect, check whether a task is in flight and restore the progress UI automatically rather than showing a stale "idle" state.

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
- **"Night Shift" design language** (don't dilute it):
  - `slate-*` is re-tinted to a deep indigo-ink scale in `tailwind.config.ts` — never reference raw grays; keep using `slate-*` utilities.
  - `signal` (#FFB224 amber) is reserved for the agent: primary buttons, live scan activity, the on-watch pulse, active nav. Don't use amber tints for neutral chips/badges — statuses keep their own hues (`statusColor`/`statusBarColor` in `utils.ts`).
  - Three faces via `next/font` variables: `font-display` (Bricolage Grotesque — headings get it automatically from `globals.css`, also big stat numerals), `font-sans` (Instrument Sans, body), `font-mono` (JetBrains Mono). Rule: **machine-produced data is mono** — timestamps, counts, fit scores, sources, emails, table headers, eyebrow labels; human content is sans.
  - The sidebar rail (`layout.tsx` + `src/components/nav.tsx`) stays `bg-slate-950` in *both* themes by design — its `white/…` overlay colors intentionally have no `dark:` twins. On small screens it folds into a top strip (`MobileNav`).
  - Page header pattern: mono uppercase eyebrow → `text-3xl font-semibold` h1 → one-line muted subtitle.
  - The Chrome extension mirrors the theme with plain CSS variables (no Tailwind) in `extension/popup/popup.css`, `extension/options/options.css`, and `extension/content/content.css` — same ink hexes, `--signal` amber, mono-for-data rule. Keep them in sync if the palette changes.

## Environment (`.env`)

`DEEPSEEK_API_KEY` (scoring/personalization skip gracefully without it), `SMTP_USER`/`SMTP_PASS` (Gmail app password), `EXTENSION_API_KEY`, `DATABASE_URL` (`file:./dev.db`).
