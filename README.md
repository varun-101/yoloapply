# YOLOapply

Multi-user AI job-application agent. Each user signs up, fills in their profile,
project bank, search filters, and credentials under Settings — then the app discovers
junior postings for them, fit-scores them, personalizes a LaTeX resume per job
description, drafts cold emails to founders, semi-auto-applies via a Chrome extension,
and tracks every application.

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Prisma** + Supabase Postgres; files (resume PDFs, cover letters) in a private
  Supabase Storage bucket
- **Clerk** for auth; per-user secrets (DeepSeek key, SMTP password) AES-256-GCM
  encrypted at rest
- **DeepSeek** (`deepseek-chat`, OpenAI-compatible API at `api.deepseek.com`) for
  fit-scoring, resume tailoring, and cold-email drafting — each user brings their own key
- **LaTeX** template (escaped via a typed builder) → PDF via remote service
  (texlive.net with latex.ytotech.com fallback) or local `tectonic`/`pdflatex` if installed
- **Nodemailer** — cold emails send via each user's own Gmail SMTP app password
- **Chrome extension** (`extension/`) for in-page job extraction and form prefill
  (human-in-the-loop submit)

## Getting started

```powershell
# 1. Install deps (Playwright browser download is skipped here; install it on demand)
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
npm install

# 2. Copy .env.example -> .env and fill in Supabase, Clerk, and encryption keys
copy .env.example .env
notepad .env

# 3. Apply migrations
npm run db:deploy

# 4. Start the app
npm run dev
# -> http://localhost:3001
```

Per-user DeepSeek and SMTP credentials are entered in the app under Settings →
Credentials, not in `.env`.

## How it flows

0. **Discover** — one global fetch pulls fresh postings from all sources (community
   freshers sheet, jobfound.org, a ~1,000-company Greenhouse/Lever/Ashby watchlist,
   and the monthly HN "Who is hiring" thread), then fans out per user: their title and
   location filters apply, leads are deduped across sources by canonicalized apply URL,
   checked against their existing applications, and fit-scored 0-100 by DeepSeek
   against their profile. Runs every 3 hours in-process (`ENABLE_CRON=1`) or on demand
   via the dashboard "Scan now" / `npm run discover`.
1. **Promote** — a lead becomes an application (or paste a JD manually).
2. **AI personalization** — DeepSeek reads the JD, picks the 3-4 most relevant projects
   from the user's project bank, writes tailored bullets, and reorders skills.
   Everything stays traceable to the user's profile and projects — no fabrication.
3. **LaTeX → PDF** — rendered into a clean ATS-friendly one-page template and compiled.
4. **Apply** — the Chrome extension extracts the form, prefills the obvious fields, and
   uploads the PDF. The user reviews and clicks submit themselves.
5. **Cold outreach** — draft a sharp 4-sentence email to a leader at the company, sent
   from the user's own SMTP account with the personalized PDF attached.
6. **Tracker** — every state change and event is logged on the application's timeline.

## What this deliberately does NOT do

- **Click submit on your behalf.** Most job portals have CAPTCHAs / multi-step flows
  / ToS clauses that automation violates. The extension stops at the filled form for
  you to review and submit.
- **Mass-email thousands of strangers.** Cold emails are drafted one at a time, with a
  rationale you can read before sending. Be a person.
- **Mint facts that aren't on your resume.** The personalizer is constrained to your
  profile and project bank (Settings → Profile / Projects). If you want a new claim on
  the resume, add it there first.

## Files of note

- `src/lib/profile.ts` / `src/lib/projectBank.ts` — per-user profile and project bank.
- `src/lib/latex.ts` — the LaTeX resume template + a typed builder.
- `src/lib/llm.ts` — DeepSeek client (OpenAI SDK pointed at `api.deepseek.com`).
- `src/lib/personalize.ts` — LLM prompt for resume tailoring.
- `src/lib/coldEmail.ts` — LLM prompt for cold outreach.
- `src/lib/discovery/` — job discovery: source fetchers and the dedupe/ingest
  pipeline (`pipeline.ts`).
- `src/lib/auth.ts` — Clerk + extension-token auth (`requireUser`).
- `extension/` — standalone Chrome extension (vanilla JS).

See `CLAUDE.md` for the full architecture notes.
