---
name: run-yoloapply
description: Build, run, and drive YOLOapply. Use when asked to start the app, run the dev server, take a screenshot of a page, smoke-test the UI, or interact with the running app (dashboard, discover feed, applications, cold email pages).
---

YOLOapply is a single-user Next.js 14 app (Prisma + SQLite) that runs locally on Varun's Windows machine at **http://localhost:3001** (not 3000). Drive it with the Playwright harness at `.claude/skills/run-yoloapply/driver.mjs` — it attaches to an already-running dev server (common: Varun usually has one up) or starts one itself.

All paths are relative to the repo root. All commands are PowerShell.

## ⚠ Safety — this is a live machine

The DB is Varun's real application/outreach data; `.env` holds a paid DeepSeek key and real Gmail SMTP credentials. From automation, stay **read-only**:

- Never `POST /api/discovery/run` (kicks a multi-minute scan + DeepSeek scoring spend).
- Never touch `/api/cold-email/send` or anything that emails real founders.
- Don't click Promote / Dismiss / Scan now / Send unless explicitly asked.

GET endpoints and page navigation are always safe.

## Prerequisites

Node 24 + npm are installed. Playwright is a repo dependency and its Chromium is already in `%LOCALAPPDATA%\ms-playwright`; if it ever goes missing:

```powershell
npx playwright install chromium
```

## Setup

Dependencies are already installed on this machine. If you must reinstall: **stop the dev server first** — `npm install` runs `prisma generate` (postinstall), which fails with `EPERM ... query_engine-windows.dll.node` while the server has the DLL loaded. Same rule for `npm run db:push` after schema edits (see CLAUDE.md).

## Run (agent path) — the driver

One-shot read-only smoke (API checks + 5 pages + screenshots + console-error check):

```powershell
node .claude\skills\run-yoloapply\driver.mjs smoke
```

Prints `PASS — all pages rendered, no console errors` and exits 0 on success. If no server is on 3001 it spawns `npm run dev` detached (log: `$env:TEMP\yoloapply-dev.log`, pid file: `$env:TEMP\yoloapply-dev.pid`) and leaves it running afterwards; an already-running server is reused and never killed.

Ad-hoc interaction — pipe REPL commands on stdin:

```powershell
@'
nav /contacts
wait Contacts
ss contacts
get /api/discovery/run
errors
exit
'@ | node .claude\skills\run-yoloapply\driver.mjs repl
```

| command | what it does |
|---|---|
| `nav <path>` | goto `http://localhost:3001<path>` |
| `wait <text>` / `waitsel <sel>` | wait until text / selector is visible |
| `click <sel>` / `fill <sel> <val>` / `select <sel> <val>` | interact (Playwright pipeline — fires React onChange) |
| `text <sel>` | print innerText |
| `get <apiPath>` | GET the API, print JSON |
| `ss [name]` | screenshot → `.claude/skills/run-yoloapply/screenshots/<name>.png` |
| `errors` | print console/page errors collected so far |

Screenshots land in `.claude/skills/run-yoloapply/screenshots/` (gitignored). They are **viewport-only** (1440×900) on purpose — see Gotchas.

Useful read-only API probes: `get /api/discovery/run` (scan status: `idle`/`running` + last result), `get /api/discovery/scans?take=1`, `get /api/discovery/leads?status=new`.

## Run (human path)

```powershell
npm run dev   # Next.js on http://localhost:3001 — Ctrl-C to stop
```

If the driver started the server: `taskkill /PID (Get-Content $env:TEMP\yoloapply-dev.pid) /T /F`.

## Test

No test suite. Typecheck:

```powershell
npx tsc --noEmit
```

Expected: exactly 3 pre-existing errors (`scripts/auto-apply.ts`, `src/app/api/resume/file/route.ts`, `src/lib/onePage.ts`). Anything else is new breakage.

## Gotchas

- **`npm install` fails while the dev server runs** — postinstall `prisma generate` can't rename the locked `query_engine-windows.dll.node` (`EPERM`). Stop the server, install, restart. (Hit this live; the old DLL stays in place so the running app survives the failed attempt.)
- **Full-page screenshots are unusable on `/discover`** — the feed holds hundreds of leads; `fullPage: true` produced a 1440×52,392px image. The driver screenshots the viewport only.
- **Client pages paint a spinner first** — `/discover` and `/discover/history` fetch after mount. The driver waits for the matching API response (`/api/discovery/leads`, `/api/discovery/scans`) before screenshotting; a bare `nav` + `ss` captures the loader.
- **A scan may be running at any time** — Task Scheduler triggers one every 3 h, and `GET /api/discovery/run` may report `running` for several minutes. That's normal, not a hung app.

## Troubleshooting

- **`EPERM ... query_engine-windows.dll.node`** during `npm install` / `prisma generate` / `db:push`: dev server is running and locks the engine DLL. Stop it first.
- **Driver exits `FAIL — dev server did not come up within 60s`**: check `$env:TEMP\yoloapply-dev.log` — usually a port conflict or the EPERM above corrupting the Prisma client.
