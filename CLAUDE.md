# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YOLOapply is a multi-user AI job-application agent. Each user signs up (Clerk), fills in their own profile/projects/search filters/credentials under Settings, and the app discovers junior postings for them, fit-scores them, personalizes a LaTeX resume per JD, drafts cold emails to founders, semi-auto-applies via a Chrome extension, and tracks every application. Built by Varun (whose legacy single-user data was migrated into his account via a one-time import script, since removed). Postgres + file storage live on Supabase; hosting target is Railway.

## Commands

```powershell
npm run dev          # Next.js on http://localhost:3001 (NOT 3000)
npm run build        # production build
npm run start        # production server (honors $PORT — Railway sets it)
npm run discover     # one full discovery tick: global fetch + per-user fan-out
npm run db:migrate   # prisma migrate dev (see schema-change gotcha below)
npm run db:deploy    # prisma migrate deploy (production)
npm run db:studio    # browse the Postgres DB
npx tsc --noEmit     # typecheck — no test suite exists
npx tsx scripts/seed-ats-companies.ts   # re-seed ATS watchlist from data/ats-companies/probe-results.json
npx tsx scripts/probe-ats-companies.ts  # re-probe all ~10k boards in the dataset (~5 min), then re-seed
```

- One-off scripts: write to `scripts/*.ts`, run with `npx tsx`, start with `try { process.loadEnvFile(".env") } catch {}`.
- Known pre-existing tsc errors (don't fix unless asked, don't count as new breakage): `scripts/auto-apply.ts` (line ~155 playwright overload), `src/lib/onePage.ts` (line ~37 Buffer generic).
- Scheduled discovery runs in-process: node-cron in `src/instrumentation.ts`, every 3h, only when `ENABLE_CRON=1` (set it on exactly ONE instance). The old Windows Task Scheduler entry is gone.

## Hard constraints

- **LLM is DeepSeek, never Anthropic/OpenAI cloud** — `src/lib/llm.ts` uses the OpenAI SDK pointed at `api.deepseek.com`. Every user-facing call runs on the USER's own key (`getDeepseekKey(userId)` from `src/lib/credentials.ts`, passed as `apiKey` to `chatJson`). The env `DEEPSEEK_API_KEY` (`serverApiKey()`) is operator-paid and used ONLY for global HN thread extraction.
- **No fabricated resume facts.** Personalization/cold-email/answer prompts may only draw on the user's `UserProfile` (`src/lib/profile.ts`) and their `Project` rows (`src/lib/projectBank.ts`) — both edited under Settings.
- **Outbound email** sends via the user's own SMTP creds (Gmail app password, encrypted at rest) — `sendEmail(userId, …)` in `src/lib/mailer.ts`. Never a shared sender.
- **Never auto-submit applications or mass-email.** The extension prefills and stops for human review; cold emails are drafted one at a time.
- **Tenant isolation**: every API route starts with `requireUser(req)` (`src/lib/auth.ts`); detail routes use `findFirst({ where: { id, userId } })` → 404, so cross-tenant ids look nonexistent. Server pages use `requirePageUser()`.
- **Secrets at rest**: DeepSeek keys and SMTP passwords are AES-256-GCM encrypted (`src/lib/crypto.ts`, `APP_ENCRYPTION_KEY`); extension tokens are stored as sha256 hashes. Never return a stored secret to the client (the credentials GET returns presence + last-4 only).

## Programming style — robust long-running operations

Every feature that triggers a non-trivial background task (discovery scans, resume generation, LLM scoring batches, email sends, etc.) **must** be implemented with the following guarantees from day one. Do not ship the happy path first and bolt these on later.

### 1. Backend owns the lifecycle — survive frontend disconnects

The backend must drive the task to completion regardless of what happens on the client side. If the browser tab is closed, the network drops, or the user navigates away, the task **must keep running** and its result must be retrievable later.

- Kick off work from the API route handler, but do not tie progress to the response stream being open.
- Persist task state (status, progress, result, error) in the database or an in-memory store keyed by a stable identifier so the frontend can poll or reconnect.

### 2. Idempotent retries — reject duplicate kicks, notify the caller

If the frontend (or cron, or extension) calls the same long-running endpoint while a previous invocation is still in flight:

- **Do not start a second run.** Detect the in-flight task (via a module-level lock, DB status flag, or concurrency guard).
- **Return an informative response** (e.g., `{ status: "already_running", startedAt, progress }`) so the client can show appropriate UI ("Scan already in progress…") instead of silently queuing or erroring.
- The discovery pipeline's join-the-in-flight-run pattern (`runGlobalFetch` global lock + `runUserScan` per-user locks in `src/lib/discovery/pipeline.ts`) is the reference implementation — replicate this approach for every new long-running feature.

### 3. Status & progress tracking

- Expose a lightweight status endpoint (or reuse the kick-off endpoint with GET) so the frontend can poll: `idle | running | completed | failed`, plus optional progress percentage and partial results.
- On completion or failure, persist the outcome so it is visible even if no client was listening at the time.

### 4. Frontend resilience

- The UI must handle the `already_running` response gracefully — show a banner/toast, disable the trigger button, and begin polling for progress.
- On page load or reconnect, check whether a task is in flight and restore the progress UI automatically rather than showing a stale "idle" state.

**Caveat:** the in-memory locks/progress maps live on `globalThis` and assume a SINGLE server instance. If the app is ever scaled horizontally, they must move to DB-backed locks.

## Architecture

Next.js 14 App Router. Pages under `src/app/**` are client components fetching `src/app/api/**` route handlers (or server components using Prisma directly); all business logic lives in `src/lib/**`. Prisma 5 + **Supabase Postgres** (`DATABASE_URL` pooled :6543, `DIRECT_URL` direct :5432 for migrations). Files (resume PDFs/tex, cover letters, generic resumes) live in a private **Supabase Storage bucket**; `src/lib/files.ts` is the only module that talks to it (`StoredFile` table holds metadata + bucket path).

### Auth (`src/lib/auth.ts` + `src/middleware.ts`)

- Clerk v6: `clerkMiddleware` protects pages (redirect to `/sign-in`); `/api/*` falls through and handlers 401 via `requireUser`.
- `requireUser(req)`: `Authorization: Bearer yolo_…` (extension token, sha256 → `UserCredential`) → user; otherwise Clerk `auth()` → `ensureUser(clerkId)`.
- `ensureUser` is lazy (no webhooks): lookup by clerkId → claim an existing row by email match (sets the nullable `clerkId` — this is how the migrated legacy user attaches on first sign-in) → create.
- Middleware order matters: extension-origin OPTIONS → 204+CORS before Clerk; extension origins pass through with CORS (Edge middleware can't run Prisma — token validation happens in handlers); other cross-origin → 403.
- Typed errors: `ApiUserError(message, status, code)` → `apiError(e)` maps to JSON. Codes the UI understands: `no_profile`, `no_llm_key`, `no_smtp` (each points the user to the right Settings tab).

### Per-user data accessors (`src/lib/`)

`profile.ts` (`getProfile`/`getProfileOrNull`/`resumeFilename`), `projectBank.ts` (`getProjectBank`), `searchPrefs.ts` (`ensureSearchPrefs` + pure `titleMatches`/`locationMatches`), `credentials.ts` (DeepSeek/SMTP/extension token), `files.ts` (bucket), `setup.ts` (`getSetupStatus` → dashboard checklist). Settings UI lives at `src/app/settings/{profile,projects,search,credentials}` backed by `src/app/api/settings/**`.

### Discovery: one global fetch, per-user fan-out (`src/lib/discovery/`)

`runFullTick(trigger)` in `pipeline.ts` is the scheduled entry (cron + `scripts/discover.ts`); `startUserScan(userId)` backs the dashboard "Scan now":

1. **`runGlobalFetch`** (join-in-flight global lock, recorded as a `FetchRun` row) fetches all 4 sources once, in parallel: `sheet.ts` (community freshers XLSX, tier 1), `jobfound.ts` (Hygraph GraphQL, tier 1), `ats.ts` (tier 2), `hn.ts` (monthly "Who is hiring", tier 3, often yields founder emails). Tiers in `types.ts` drive default queue ordering. `ingestCatalog` then dedupes into the shared `JobLead` catalog in three layers: `(source, externalId)` exact → `canonicalUrl` → `dedupeFingerprint` (normalized company+role) **within `REPOST_WINDOW_MS` (15 days)** — the last catches a posting reappearing under a new id or a different board, while a same-role re-opening beyond the window coexists as a fresh posting (window measured on `postedAt`, else found date). A match merges the extra source label + backfills a missing JD instead of creating a row. Backfill existing duplicates with `npx tsx scripts/dedupe-catalog.ts` (`--dry-run` to preview).
2. `ats.ts` scans ~1,020 companies from the **global `AtsCompany` table** via official unauthenticated Greenhouse/Lever/Ashby board APIs — concurrency 12, 20s timeouts. The prefilter keeps a posting if it matches ANY participating user's prefs. Self-maintaining: 5 consecutive failures → `active=false`. Greenhouse JDs are fetched per-job (capped 25/board), skipped only for postings every participant already has; `hn.ts` extraction (server-level DeepSeek key) skips on the same rule.
3. **`fanOutUser`** then runs per user (their `ScanRun`, linked to the `FetchRun`): the user's `SearchPreference` title/location filters apply to ATS+HN only (tier-1 is curated, passes through); dedupe per user — `[userId, source, externalId]` unique, then cross-source by canonicalized URL, then skip anything matching their Applications; greenhouse leads missing JD text sibling-copy it from another user's lead; finally `scoreNewLeads(userId)` (user's key, capped 45/run — backlogs drain across runs; skips gracefully without key/profile).
4. Scheduled fan-out covers users with `discoveryEnabled=true` (forced off while their location list is empty); "Scan now" works regardless and joins any in-flight global fetch.
5. Sources can partially fail — only `fetched === 0` is a real failure; the UI shows per-source counts + partial-error notes. Stale open ScanRuns (>30 min, `SCAN_STALE_MS`) are treated as dead.

### Application flow

Lead promote (or manual entry) → `Application` row → `personalize.ts` (DeepSeek picks 3-4 of the user's projects, tailors bullets per JD; `experienceBullets` is indexed per experience entry) → `latex.ts` (typed LaTeX builder, ATS-friendly) → `compile.ts` (remote texlive.net / latex.ytotech.com, local `tectonic`/`pdflatex` if installed) → PDF into the bucket via `saveResumeArtifacts`. `onePage.ts` enforces one-page output. Status changes and emails append `Event` rows.

### Chrome extension (`extension/`)

Standalone vanilla-JS extension; nothing is bundled into or imported from the Next.js app. It authenticates with a per-user `yolo_…` token generated under Settings → Credentials (hash stored in `UserCredential`), sent as `Authorization: Bearer`. Backend support (CORS, token auth, `/api/extract-job/dom`, `/api/autofill-map`, `/api/answer-question`, `/api/profile`) lives in the main app.

### Schema-change gotcha (recurring trap)

`src/lib/db.ts` caches `PrismaClient` on `globalThis`, so it survives HMR — and the running dev server locks the Prisma engine DLL on Windows. After editing `prisma/schema.prisma`: **stop the dev server, then `npm run db:migrate`, then restart**. Otherwise you get `EPERM ... query_engine-windows.dll.node` during generate and `Cannot read properties of undefined (reading 'findMany')` for new models at runtime. Same restart rule applies to `tailwind.config.ts` changes. Postgres note: `contains` is case-sensitive — use `mode: "insensitive"` for text search.

## UI conventions

- Tailwind with `darkMode: "class"`. Every hardcoded color utility must carry a `dark:` twin (convention: `bg-white`→`dark:bg-slate-900`, `bg-slate-50`→`dark:bg-slate-950`, `text-slate-500`→`dark:text-slate-400`, badge tints `*-100/*-800`→`dark:*-950/dark:*-300`). Theme is applied pre-paint by an inline script in `layout.tsx`; the toggle is `src/components/theme-toggle.tsx`.
- shadcn-style primitives in `src/components/ui/` (button/card/badge/input) with `cn()` from `src/lib/utils.ts`.
- **"Night Shift" design language** (don't dilute it):
  - `slate-*` is re-tinted to a deep indigo-ink scale in `tailwind.config.ts` — never reference raw grays; keep using `slate-*` utilities.
  - `signal` (#FFB224 amber) is reserved for the agent: primary buttons, live scan activity, the on-watch pulse, active nav. Don't use amber tints for neutral chips/badges — statuses keep their own hues (`statusColor`/`statusBarColor` in `utils.ts`).
  - Three faces via `next/font` variables: `font-display` (Bricolage Grotesque — headings get it automatically from `globals.css`, also big stat numerals), `font-sans` (Instrument Sans, body), `font-mono` (JetBrains Mono). Rule: **machine-produced data is mono** — timestamps, counts, fit scores, sources, emails, table headers, eyebrow labels; human content is sans.
  - The sidebar rail (`layout.tsx` + `src/components/nav.tsx`) follows the theme like the rest of the app: `bg-white` in light, `dark:bg-slate-950` in dark. Every rail color (links, footer, theme toggle) carries both a light base and a `dark:` twin — the old `white/…` overlays are now `dark:`-only, paired with `slate-100`/`slate-600` light equivalents. On small screens it folds into a top strip (`MobileNav`).
  - Page header pattern: mono uppercase eyebrow → `text-3xl font-semibold` h1 → one-line muted subtitle.
  - The Chrome extension mirrors the theme with plain CSS variables (no Tailwind) in `extension/popup/popup.css`, `extension/options/options.css`, and `extension/content/content.css` — same ink hexes, `--signal` amber, mono-for-data rule. Keep them in sync if the palette changes.

## Environment (`.env`)

See `.env.example`. `DATABASE_URL`/`DIRECT_URL` (Supabase Postgres), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_BUCKET` (private storage bucket), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY`, `APP_ENCRYPTION_KEY` (32B base64 — rotating it orphans every stored secret), `DEEPSEEK_API_KEY` (HN extraction only), `ENABLE_CRON` (1 on exactly one instance), `LATEX_MODE`. Per-user DeepSeek/SMTP creds live in the DB, not env.
