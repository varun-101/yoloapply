# YOLOapply

AI-driven job-application agent. Personalizes a LaTeX resume per job description,
tracks every application, drafts cold emails to founders/CEOs, and (semi-)auto-applies
via Playwright.

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Prisma** + SQLite (zero-setup local DB at `prisma/dev.db`)
- **DeepSeek** (`deepseek-chat`, OpenAI-compatible API at `api.deepseek.com`) for resume
  tailoring + cold-email drafting
- **LaTeX** template (escaped via a typed builder) → PDF via remote service
  (texlive.net with latex.ytotech.com fallback) or local `tectonic`/`pdflatex` if installed
- **Nodemailer** Gmail SMTP — sends from `varunchandwani101@gmail.com` (configurable)
- **Playwright** worker for portal/LinkedIn prefill (headed, human-in-the-loop submit)

## Getting started

```powershell
# 1. Install deps (Playwright browser download is skipped here; install it on demand)
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
npm install

# 2. Copy .env.example -> .env and fill in:
#    DEEPSEEK_API_KEY=sk-...
#    SMTP_USER=varunchandwani101@gmail.com
#    SMTP_PASS=<gmail app password from https://myaccount.google.com/apppasswords>
copy .env.example .env
notepad .env

# 3. Push the Prisma schema to create the SQLite DB
npx prisma db push

# 4. Start the app
npm run dev
# -> http://localhost:3001
```

When you want to actually run the Playwright auto-apply worker:

```powershell
npx playwright install chromium
```

## How it flows

0. **Discover** — the `/discover` page pulls fresh postings from multiple sources:
   tier 1 (most trusted, always on top) is a community freshers sheet (Google Sheets
   XLSX export, hyperlinks preserved) and jobfound.org (public Hygraph GraphQL API);
   tier 2 is a watchlist of company boards on Greenhouse/Lever/Ashby (official APIs,
   keyword + location filtered — edit `src/lib/discovery/config.ts`); tier 3 is the
   monthly HN "Who is hiring" thread (LLM-extracted, often with founder emails that
   feed the cold-email flow). Leads are deduped across sources by canonicalized apply
   URL, checked against existing applications, and fit-scored 0-100 by DeepSeek
   against your profile. *Promote* turns a lead into an application; *Promote +
   Personalize* also kicks off resume tailoring; *Fetch JD* pulls a missing job
   description from the posting URL. `npm run discover` runs the same scan headless —
   a Windows Task Scheduler entry ("YOLOapply Discover") runs it every 3 hours, and
   the browser extension badge shows fresh tier-1 leads. Apply early — early
   applications get reviewed first.
1. **New application** — paste the JD URL + JD text, name the company and role, click
   *Save & personalize resume*.
2. **AI personalization** — DeepSeek reads the JD, picks 3-4 most relevant projects from
   your curated bank (sourced from `D:\portfolio\src\constants.ts`), writes tailored
   bullets, reorders skills, and rewrites your Loan-for-India internship bullets to
   match the JD's vocabulary. Everything stays traceable to facts in your actual work
   — no fabrication.
3. **LaTeX → PDF** — the draft is rendered into a clean ATS-friendly LaTeX template and
   compiled to a PDF (remote service by default; uses local `tectonic`/`pdflatex` if
   available).
4. **Apply** — open the PDF in the dashboard. Click *Auto-apply* to launch a Playwright
   browser that opens the portal, prefills the obvious fields, and uploads your PDF.
   You review and click submit yourself.
5. **Cold outreach** — from any application page, draft a sharp 4-sentence email to a
   leader at the company. Send it from your own SMTP account with the personalized PDF
   attached. The contact is recorded.
6. **Tracker** — every state change (drafted, personalized, applied, replied, interview,
   offer, rejected) and event is logged on the application's timeline.

## What this deliberately does NOT do

- **Click submit on your behalf.** Most job portals have CAPTCHAs / multi-step flows
  / ToS clauses that automation violates. The worker stops at the form for you to
  review and submit.
- **Mass-email thousands of strangers.** Cold emails are drafted one at a time, with a
  rationale you can read before sending. Be a person.
- **Mint facts that aren't on your resume.** The personalizer is constrained to the
  curated project bank (`src/lib/projects.ts`) and `src/lib/owner.ts`. If you want a
  new claim on the resume, add it there first.

## Files of note

- `src/lib/projects.ts` — curated project bank (sourced from your portfolio constants).
  Update here if you want a new project considered.
- `src/lib/owner.ts` — your identity, experience, education.
- `src/lib/latex.ts` — the LaTeX resume template + a typed builder.
- `src/lib/llm.ts` — DeepSeek client (OpenAI SDK pointed at `api.deepseek.com`).
- `src/lib/personalize.ts` — LLM prompt for resume tailoring.
- `src/lib/coldEmail.ts` — LLM prompt for cold outreach.
- `src/lib/discovery/` — job discovery: source fetchers (`sheet.ts`, `jobfound.ts`)
  and the dedupe/ingest pipeline (`pipeline.ts`).
- `scripts/auto-apply.ts` — Playwright worker.
