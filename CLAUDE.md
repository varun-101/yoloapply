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
npx tsc --noEmit     # typecheck
npm test             # vitest — unit tests over the pure helpers in src/lib/** (no DB, no network)
npx tsx scripts/seed-ats-companies.ts   # re-seed ATS watchlist from data/ats-companies/probe-results.json
npx tsx scripts/probe-ats-companies.ts  # re-probe all ~10k boards in the dataset (~5 min), then re-seed
npx tsx scripts/generate-icons.ts       # re-render every PWA/home-screen icon from its one vector source
```

- One-off scripts: write to `scripts/*.ts`, run with `npx tsx`, start with `try { process.loadEnvFile(".env") } catch {}`.
- Known pre-existing tsc errors (don't fix unless asked, don't count as new breakage): `scripts/auto-apply.ts` (line ~155 playwright overload), `src/lib/onePage.ts` (line ~37 Buffer generic).
- Scheduled discovery runs in-process: node-cron in `src/instrumentation.ts`, every 3h, only when `ENABLE_CRON=1` (set it on exactly ONE instance). The old Windows Task Scheduler entry is gone.

## Hard constraints

- **LLM is DeepSeek, never Anthropic/OpenAI cloud** — `src/lib/llm.ts` uses the OpenAI SDK pointed at `api.deepseek.com`. Every user-facing call runs on the USER's own key (`getDeepseekKey(userId)` from `src/lib/credentials.ts`, passed as `apiKey` to `chatJson`). The env `DEEPSEEK_API_KEY` (`serverApiKey()`) is operator-paid and used ONLY for global HN thread extraction.
- **No fabricated resume facts.** Personalization/cold-email/answer prompts may only draw on the user's `UserProfile` (`src/lib/profile.ts`) and their `Project` rows (`src/lib/projectBank.ts`) — both edited under Settings.
- **Outbound email** always leaves from the user's OWN mailbox — `sendEmail(userId, …)` in `src/lib/mailer.ts`. Never a shared sender. Two providers, chosen explicitly in Settings (see "Outbound email" below): their SMTP creds (Gmail app password, encrypted at rest) or an Outlook account connected over OAuth.
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

`profile.ts` (`getProfile`/`getProfileOrNull`/`resumeFilename`), `projectBank.ts` (`getProjectBank`), `searchPrefs.ts` (`ensureSearchPrefs` + pure `titleMatches`/`locationMatches`), `credentials.ts` (DeepSeek/SMTP/extension token), `prompts.ts` (writing instructions, below), `files.ts` (bucket), `setup.ts` (`getSetupStatus` → dashboard checklist). Settings UI lives at `src/app/settings/{profile,projects,search,prompts,credentials}` backed by `src/app/api/settings/**`.

### User-editable prompts (`src/lib/prompts.ts`, Settings → Writing)

The four writing system prompts — resume personalization, cold email, cover letter, application answers — are **layered, never replaced**. `DEFAULT_SYSTEM[surface]` in `prompts.ts` is the single home of each base prompt (the feature modules import it, they no longer define their own `SYSTEM` const); `UserPromptSetting` holds the user's free-text `voice` (applies to all four) plus one box per surface, capped at `MAX_PROMPT_CHARS`. `composeSystem` appends them under a "THE CANDIDATE'S OWN INSTRUCTIONS" heading whose closing paragraph re-asserts the two things user text can never override: the strict-JSON schema and the no-fabricated-facts rule. Empty boxes yield the base prompt byte-for-byte, so a user who never visits the tab is unaffected. Call sites use `systemFor(userId, surface)`; `personalizeResume` takes it off `PersonalizeContext.system` so the one-page retry loop doesn't refetch it. **Don't add a full-override escape hatch** — deleting "Output STRICT JSON" from a prompt breaks generation, and the layered form was chosen deliberately over that.

### Discovery: one global fetch, per-user fan-out (`src/lib/discovery/`)

`runFullTick(trigger)` in `pipeline.ts` is the scheduled entry (cron + `scripts/discover.ts`); `startUserScan(userId)` backs the dashboard "Scan now":

1. **`runGlobalFetch`** (join-in-flight global lock, recorded as a `FetchRun` row) fetches every source once, in parallel: `sheet.ts` (community freshers XLSX, tier 1), `jobfound.ts` (Jobfound REST API, tier 1), `ats.ts` (tier 2), `instahyre.ts` (tier 2, India), `hn.ts` (monthly "Who is hiring", tier 3, often yields founder emails), plus the remote aggregators `weworkremotely.ts`/`remoteok.ts`/`remotive.ts` (tier 3). Tiers in `types.ts` drive default queue ordering. `ingestCatalog` then dedupes into the shared `JobLead` catalog in three layers: `(source, externalId)` exact → `canonicalUrl` → `dedupeFingerprint` (normalized company+role) **within `REPOST_WINDOW_MS` (15 days)** — the last catches a posting reappearing under a new id or a different board, while a same-role re-opening beyond the window coexists as a fresh posting (window measured on `postedAt`, else found date). A match merges the extra source label + backfills whatever the row is missing (JD, listed recruiter, employer site) instead of creating a row. Backfill existing duplicates with `npx tsx scripts/dedupe-catalog.ts` (`--dry-run` to preview).
2. `ats.ts` scans ~1,020 companies from the **global `AtsCompany` table** via official unauthenticated Greenhouse/Lever/Ashby board APIs — concurrency 12, 20s timeouts. The prefilter keeps a posting if it matches ANY participating user's prefs. Self-maintaining: 5 consecutive failures → `active=false`. Greenhouse JDs are fetched per-job (capped 25/board), skipped only for postings every participant already has; `hn.ts` extraction (server-level DeepSeek key) skips on the same rule.
3. `instahyre.ts` sweeps instahyre.com's two public keyless endpoints: a paginated `job_search` (35/page, server-enforced) then, for each posting that survives the shared prefilter, one `employer_profile?jobId=…` detail request (capped 40/tick) for the JD, experience band, **the recruiter the listing names**, and the employer's own website. Two API facts shape the design: `jobLocations` is validated against Instahyre's own city vocabulary and 400s on anything else (hence the verified `LOCATION_VALUES` map — an unrecognized user location widens to "Anywhere in India" rather than narrowing), and the listing carries **no date** and comes back in a ranking that rotates between requests, so each tick samples a different slice of the ~15k live postings and catalog dedupe absorbs the overlap. The recruiter lands on `JobLead.recruiterName/Title/Company` and reaches the contact finder two ways: as a `listing`-sourced candidate inside the ranked results (`src/lib/contacts/pipeline.ts`), and as a standalone `listingRecruiter` field on every `/api/contacts/find` response. The second exists because knowing this person needs no domain, no provider and no run — so the card must still show them when enrichment returns `no_domain` or finds nobody. The standalone card hides itself once the ranked list contains the same name, which by then is the richer record. `recruiterCompany` is stored separately because it is frequently a **staffing agency**, not the employer: those candidates carry `skipResolve`, keeping them out of the pattern-guess and portfolio lanes, since an address at the employer's domain would be invented. `companyUrl` (the employer's own site) becomes a `fallbackUrls` entry for domain resolution — tried only after the Clearbit name lookup, because a board reports hiring sites like `amazon.jobs` rather than the mail domain. **Never fetch an instahyre.com HTML page server-side**: Cloudflare answers with a bot challenge (403, `cf-mitigated: challenge`) that no User-Agent or header set gets around, while the JSON API is wide open. `extractFromUrl` therefore routes any Instahyre posting URL through `fetchInstahyrePosting(jobId)` (`employer_public_jobs/{jobId}`, id parsed out of the `/job-<id>-…` path) — structured fields, so it also skips the LLM extraction entirely and needs no DeepSeek key. Same fast path in `/api/discovery/leads/[id]/fetch-jd`, where it doubles as the way to backfill a recruiter onto leads the sweep's 40/tick detail cap skipped.
4. **`fanOutUser`** then runs per user (their `ScanRun`, linked to the `FetchRun`): the user's `SearchPreference` title/location filters apply to ATS+HN only (tier-1 is curated, passes through); dedupe per user — `[userId, source, externalId]` unique, then cross-source by canonicalized URL, then skip anything matching their Applications; greenhouse leads missing JD text sibling-copy it from another user's lead; finally `scoreNewLeads(userId)` (user's key, capped 45/run — backlogs drain across runs; skips gracefully without key/profile).
5. Scheduled fan-out covers users with `discoveryEnabled=true` (forced off while their location list is empty); "Scan now" works regardless and joins any in-flight global fetch.
6. Sources can partially fail — only `fetched === 0` is a real failure; the UI shows per-source counts + partial-error notes. Stale open ScanRuns (>30 min, `SCAN_STALE_MS`) are treated as dead.

### Application flow

Lead promote (or manual entry) → `Application` row → `personalize.ts` (DeepSeek picks 3-4 of the user's projects, tailors bullets per JD; `experienceBullets` is indexed per experience entry) → `latex.ts` (typed LaTeX builder, ATS-friendly) → `compile.ts` (remote texlive.net / latex.ytotech.com, local `tectonic`/`pdflatex` if installed) → PDF into the bucket via `saveResumeArtifacts`. `onePage.ts` enforces one-page output. Status changes and emails append `Event` rows.

### Outbound email: two senders (`src/lib/mailer.ts`, `src/lib/microsoft/`)

`sendEmail(userId, opts)` resolves `getSenderConfig(userId)` (`credentials.ts`) → `UserCredential.emailProvider`, which is `"smtp"` or `"microsoft"`. The choice is **stored explicitly, never inferred from what happens to be configured** — both can be set up at once, and connecting Outlook to try it must not silently change the sender on cold emails. Callers are unaffected: the signature and the `{ messageId, fromAddress }` return are identical for both paths.

**Why Graph and not SMTP for Outlook:** Microsoft is retiring Basic auth for SMTP client submission (disabled by default for existing tenants end of Dec 2026, unavailable to new tenants after). An app-password path for Outlook would have a known expiry date.

- **OAuth** (`microsoft/oauth.ts`) is hand-rolled against `login.microsoftonline.com/common` — three HTTP calls, no `@azure/msal-node` (MSAL wants to own its own token cache; this way the refresh token lands in the same `encryptSecret()` column as every other secret). Scopes: `offline_access User.Read Mail.Send Mail.Read`. `Mail.Read` is granted but **not used yet** — it's there so a Graph-backed `ReplyProvider` (`application-agent/replies.ts` defines the interface, nothing implements it) needs no re-consent later. The refresh token **rotates on every use**, so `getMicrosoftAccessToken` holds a per-user in-flight lock on `globalThis.__msTokenRefresh` (mirrors `runUserScan`); two concurrent sends spending the same token would leave the loser with a dead one and silently break the connection. `invalid_grant` → clear the connection + `microsoft_disconnected`, since nothing about it is retryable.
- **The OAuth `state`** (`microsoft/state.ts`) is HMAC-signed and carries the userId, exactly like `shareLink.ts`. That's the CSRF defence *and* it frees the callback from depending on the Clerk cookie surviving the redirect back from Microsoft — which is why `/api/oauth/microsoft/callback` deliberately does **not** call `requireUser`. Every callback outcome is a redirect into `/settings/credentials?msConnected=…|msError=…`; a person is looking at a browser tab, so a JSON error body would be a dead end.
- **Sending** (`microsoft/graphMail.ts`) posts **base64 MIME**, not Graph's JSON `message` object. This is load-bearing: the JSON form cannot carry `In-Reply-To`/`References` at all (custom `internetMessageHeaders` must start with `x-`), so it would silently break follow-up threading. `buildMime()` in `mailer.ts` compiles the same nodemailer message both providers use, via a stream transport. **Don't "simplify" this to the JSON form.**
- **Message-ID:** `sendMail` returns 202 with no body, and Exchange may rewrite the `Message-ID` we sent — but `follow-up.ts` threads off the stored value, so `graphMail.ts` reads the real one back out of Sent Items (two delayed attempts, best-effort, falling back to the locally generated id). The deterministic alternative (create draft → read its id → send) needs `Mail.ReadWrite`, a visibly heavier consent screen; this works on the `Mail.Read` already granted. Failing to look up the id must never report an already-successful send as failed.
- `microsoftConfigured()` gates the whole feature on the `MICROSOFT_*` env being present, so the Connect button is hidden rather than offering a flow that must fail.

### Public share links (`src/lib/shareLink.ts`, `/share/[token]`)

An application's resume PDF + cover letter can be shared via a public URL — Share button on the Application detail page → `POST /api/applications/[id]/share`. Tokens are **stateless, HMAC-signed** (`deriveKey("share-link-v1")` from `APP_ENCRYPTION_KEY` in `crypto.ts`) and carry `{applicationId, userId, exp}` — no DB table or migration; links expire (default 30 days, max 90) and can't be revoked individually (rotating the master key kills them all). The public surfaces — the `/share/[token]` page (allow-listed in `middleware.ts`) and `GET /api/share/[token]/file` (streams the PDFs from the bucket) — are rate-limited per-IP **and** globally via `src/lib/rateLimit.ts`, an in-memory fixed-window limiter on `globalThis` with the same single-instance caveat as the discovery locks.

### Installable app / PWA (`src/app/manifest.ts`, `public/sw.js`, `src/components/pwa/`)

The app installs to an iOS/Android home screen and opens standalone (no browser chrome). `src/app/manifest.ts` is the Next metadata route served at `/manifest.webmanifest` (exempt from the middleware matcher, so it's fetchable pre-session); the apple-specific bits iOS doesn't read from a manifest live in `metadata.appleWebApp` + `viewport` in `layout.tsx`. Every icon is rendered from **one vector source** in `scripts/generate-icons.ts` (rounded `any`, full-bleed `maskable` with the mark inside Android's safe circle, opaque `apple-touch-icon`) — edit the mark there and re-run, never hand-edit a PNG.

The service worker is **deliberately thin**: navigations are network-only with an `/offline` fallback, `/_next/static/*` + `/icons/*` are cache-first (Next's chunks are content-hashed so they can never go stale; the icon filenames are *not*, so bump `VERSION` in `sw.js` after re-running the icon script), and everything else — all of `/api/*`, Clerk, POSTs — is untouched. Nothing tenant-scoped is ever cached: this is multi-tenant, and a cached HTML page or API response is a cross-session data leak waiting to happen. `/offline` is public in `middleware.ts` precisely so the worker can precache it with `credentials: "omit"` (a signed-out shell). Registration is **production-only** (`register-sw.tsx`) because dev chunks aren't hashed; test with `npm run build && npm run start` over https or localhost (a service worker needs a secure context, so a plain-http LAN IP can't install).

`install-prompt.tsx` handles the two platforms differently because they *are* different: Chromium fires `beforeinstallprompt` (stashed, replayed on tap, and it only fires when the install criteria are met, so the banner self-hides where install is impossible), while iOS exposes no install API at all and only gets Share → Add to Home Screen instructions. Dismissal snoozes 14 days rather than disabling forever. Safe-area insets (`env(safe-area-inset-*)` in `globals.css` + on the mobile header) keep the standalone app clear of the notch and home indicator.

The same install is offered without a snooze at **Settings → App** (`src/app/settings/app/page.tsx`) — that's where someone goes after dismissing the banner. Both surfaces share `usePwaInstall` (`src/components/pwa/use-install.ts`), which captures `beforeinstallprompt` at **module scope, not in a component effect**: the event fires once, early, and is never re-fired, so a component that mounts later (Settings) or one that returned early while snoozed (the banner) would otherwise have no prompt to replay. Two consequences to keep in mind when touching this: the browser prompt is **single-use** — after `prompt()` resolves, `canInstall` goes false whether the user accepted or cancelled, so a "cancelled" state needs its own render branch or the card silently falls back to "install not offered" — and `beforeinstallprompt` never fires in `npm run dev` at all, because the service worker is production-only, so the settings card correctly shows its "not offered here" copy locally. Test installs against `npm run build && npm run start`.

### Interview coach (`src/lib/interview/`, `src/app/interview/`)

A voice (or typed) mock interview that **feels like a real interview** — depth-first cross-questioning on each topic, not flat Q&A — then debriefs the candidate. Grounded in the same data as the resume (`UserProfile` + `Project` bank), so the **no-fabricated-facts rule applies**: the interviewer may probe things not in the profile (that's how you probe) but never *asserts* them. Two modes: **company** (launched from an `Application`, grounded in its `jdText`) and **general** (resume-only). Runs on the **user's own LLM key** (`getLlmConfig`) like every user-facing call — ≈1-2¢ per full interview.

**Conversation model — threads, not questions.** A session plans `topics` (`planTopics`, default 4 — scales to the time budget via `topicCountFor`, 3-8); each becomes a depth-first thread. The unit of work is "decide the next move", not "ask question N": after every answer `advanceTurn` returns a `move` — `DRILL` (deeper on what they just said — the default), `CHALLENGE` (push back on vague / "we did X" answers), `PIVOT` (same topic, new angle), or `MOVE_ON` (thread mined out / strong answer / stuck → next topic). The whole current-topic thread is fed back in so it cross-questions coherently. Hard backstops in `session.ts` guarantee termination: `HARD_DEPTH_CAP` (6) per topic, `MAX_TURNS` (24) total — the engine also soft-nudges toward `MOVE_ON` near `DEPTH_CAP` (4).

**Optional time limit (`InterviewSession.timeLimitMin`, null = untimed).** A *target*, not a hard cut. Topic count scales to it; `timeWrapState` (in `session.ts`, computed each `advanceTurn` from `startedAt`) returns `"soon"` in the last 25% → the interviewer winds down, or `"now"` past the limit → it gives a closing remark and the session finalizes at that turn boundary. So it lands ~around the requested length, always ending on a natural turn (never mid-answer). The room shows a live countdown chip; untimed sessions behave exactly as before.

**Combined interviewer+examiner call.** `advanceTurn` is ONE `chatJson` call that both grades the last answer (hidden `assessment`: relevance/specificity/correctness/communication 0-5) AND produces the next interviewer line. Halves latency/cost and lets the hidden grade steer the next move, so coaching is *baked into the conversation* rather than announced. **Feedback is hidden during the session** (stored on `InterviewTurn.feedback`, never sent to the live UI) and only revealed at the end: `buildReport` composes all hidden grades into `InterviewSession.report` (overall + per-dimension + strengths/gaps/actions/perTopic). All model lines go through `deAi()`.

**Data + lifecycle.** `InterviewSession` (mode/persona/roundType/status/topics/currentTopic/report) + `InterviewTurn` (question/answer/hidden feedback/move/depth), tenant-isolated via `findFirst({ id, userId })`. Follows the long-running-ops rules: per-session in-flight lock on `globalThis` (`__interviewAdvance`, mirrors `runUserScan`) → duplicate answer-submits return `already_running`; status persisted so a refresh restores mid-interview (`GET /api/interview/[id]`); stale `running` sessions >30 min (`STALE_MS`) → `abandoned`. Routes: `POST /api/interview` (create+`planTopics`), `GET /[id]` (restore), `POST /[id]/answer` (grade+advance), `POST /[id]/finish` (end+report).

**Voice is Tier-1 browser-native (`src/components/interview/useVoice.ts`), 100% client-side** — Web Speech API, no server audio, no keys, fits the user-pays model. **Defaults to voice**, falls back to typing. Hard browser realities baked into the UX:
- STT (`SpeechRecognition`) is **Chrome/Edge/Safari only** (no Firefox) and streams mic audio to a *cloud* service — **Edge/Brave/Arc throw `network` errors** (backend unreachable, unfixable client-side). On any failure `lastError` surfaces an actionable message + one-click "Switch to typing". Typed mode is always a complete fallback (you still hear questions, still get the report).
- **Endpointing is a state machine, not a naive timer** (the subtle part). Only a *deliberate* end submits: a sustained pause **after** speech (`DEFAULT_SILENCE_MS` 5s, armed only once the candidate has actually spoken) or tapping **Done**. Any *other* recognizer end (browser quiet-timeout, `no-speech`, hiccup) is treated as unexpected and **transparently restarts** (`MAX_RESTARTS` 8, reset on real speech) so a thinking pause is never submitted as a finished answer. An **"Auto-submit on pause"** toggle lets long-pausers go fully manual (Done-only).
- TTS (`SpeechSynthesis`) prefers a natural/network voice but **retries once with a local voice on `synthesis-failed`** (Edge's "Online (Natural)" cloud voices flake) so audio always plays; `resume()` keep-alive for long lines. **Nothing is re-spoken when the interview ends** — the closing line shows in the transcript only; an effect cancels speech/mic the moment `status !== running` (re-speaking the last line at the end read as a bug).
- Tier-2 (uniform cross-browser voice via a user-supplied Deepgram/cloud-STT key, reusing the encrypted-credentials pattern) is **deliberately not built** — the upgrade path if browser-native inconsistency ever matters.

Entry points: nav **Operate → Interview prep**; **"Practice interview"** button on the Application detail page (deep-links `?app=<id>` to preselect company mode).

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
  - The sidebar rail (`layout.tsx` + `src/components/nav.tsx`) follows the theme like the rest of the app: `bg-white` in light, `dark:bg-slate-950` in dark. Every rail color (links, footer, theme toggle) carries both a light base and a `dark:` twin — the old `white/…` overlays are now `dark:`-only, paired with `slate-100`/`slate-600` light equivalents. On small screens it is replaced by a bottom tab bar (`BottomNav`, see the mobile rules below), leaving only a slim identity strip on top.
  - Page header pattern: mono uppercase eyebrow → `text-2xl sm:text-3xl font-semibold` h1 → one-line muted subtitle. A primary action next to the title goes `w-full sm:w-auto`.
  - The Chrome extension mirrors the theme with plain CSS variables (no Tailwind) in `extension/popup/popup.css`, `extension/options/options.css`, and `extension/content/content.css` — same ink hexes, `--signal` amber, mono-for-data rule. Keep them in sync if the palette changes.

### Mobile is a first-class layout, not a fallback

The app is installed to phone home screens (see the PWA section), so every page must be usable one-handed at 390px. The rules that keep it that way:

- **Bottom tab bar, not a scrolling strip.** `BottomNav` in `nav.tsx` pins Home / Discover / Pipeline / Interview plus a **More** bottom sheet (every other rail destination, same sections, plus sign-out). Both navigations share `activeHref`, so highlighting can't drift. The old top strip scrolled sideways and hid destinations off the right edge — don't reintroduce that pattern. `layout.tsx` pads `<main>` by the bar's height so nothing hides behind it.
- **Never put a table on a phone.** Give small screens a tappable `<ul>` list (`md:hidden`) and keep the table for `hidden md:block` — see `/applications`, `/contacts` and the dashboard. Side-scrolling a 6-column table pushed the identifying column off-screen. Dense admin-only tables may still scroll inside their card.
- **Stack, don't squeeze.** A card whose actions sit beside its text needs `flex-col … md:flex-row`; otherwise a `shrink-0` button column starves the `min-w-0` text column and titles wrap one word per line (this is exactly what broke the Discover lead cards). Long primary actions go `w-full md:w-auto`, secondary ones `flex-1 md:flex-none`.
- **Touch targets ≥44px.** The `Button` and `Input` primitives are already `h-11 md:h-9`; raw `<select>`/`<input>` elements must carry the same `h-11 md:h-9`.
- **16px fields.** `globals.css` forces `font-size: 16px` on inputs under `md` — below that iOS Safari zooms the viewport on focus and never zooms back. Don't override it with a smaller inline font size.
- **Safe areas.** `env(safe-area-inset-*)` is applied to the body, the mobile header, and the tab bar; anything else `fixed` to a screen edge needs its own inset.
- **Full-height panels use `dvh`, not `vh`** (`100vh` on mobile Safari means the expanded viewport, so the bottom of the pane hides behind the URL bar), and must subtract the mobile chrome — see the interview room's height calc.

## Environment (`.env`)

See `.env.example`. `DATABASE_URL`/`DIRECT_URL` (Supabase Postgres), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_BUCKET` (private storage bucket), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`CLERK_SECRET_KEY`, `APP_ENCRYPTION_KEY` (32B base64 — rotating it orphans every stored secret), `DEEPSEEK_API_KEY` (HN extraction only), `ENABLE_CRON` (1 on exactly one instance), `LATEX_MODE`, `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`/`MICROSOFT_REDIRECT_URI` (optional — the operator-owned Entra app registration behind "Connect Outlook"; omit them and the button hides). Per-user DeepSeek/SMTP creds and Outlook tokens live in the DB, not env.
