# YOLOapply — Chrome Extension

Companion extension for the YOLOapply Next.js app at `D:\yoloapply`. The extension
lives **only** in this directory — none of it is bundled into the Next.js app, and
none of the Next.js app imports from here. Backend additions (CORS middleware,
API-key auth, new endpoints) live in the main app under `src/` and `src/app/api/`.

## Install for development

1. Start the Next.js app:
   ```powershell
   cd D:\yoloapply
   npm run dev      # http://localhost:3001
   ```
2. Sign in to the web app and generate your personal API token under
   **Settings → Credentials → Chrome extension token** (it's shown exactly
   once — copy it).
3. In Chrome, open `chrome://extensions`, toggle **Developer mode** on, click
   **Load unpacked**, and pick `D:\yoloapply\extension`.
4. The Options page opens automatically on first install. Set:
   - **Backend URL:** `http://localhost:3001` (or the deployed URL)
   - **Personal API token:** the `yolo_…` token from step 2
5. Hit **Save** then **Test connection** — you should see "Connection looks good."

## What it does

Open any job-posting or application-form page (LinkedIn, Greenhouse, Workday,
Ashby, Lever, company portal, etc.). A floating **YOLOapply** widget appears in
the bottom-right with five actions:

- **Save job to dashboard** — sends the page's visible text to
  `POST /api/extract-job/dom`, the LLM extracts company/role/location/JD, and
  the app is saved as a new application. (Skips the LinkedIn login wall —
  the extension reads the DOM directly from your authenticated session.)
- **Personalize resume** — runs the same one-page resume tailoring loop as the
  web app on the just-saved application.
- **Auto-fill this form** — fetches `/api/profile` and fills name / email /
  phone / GitHub / LinkedIn / portfolio / school / degree / current role into
  matching fields (matched by name + label + aria-label + id).
- **Answer open-ended questions (LLM)** — for every empty textarea (and long
  text input with a question-shaped label), sends the question to
  `POST /api/answer-question` and types the response back. The LLM is
  constrained to the candidate's actual experience and project bank — it never
  fabricates.
- **Upload resume PDF** — pulls the personalized PDF (if you've personalized
  this application) or the generic resume, and assigns it into any
  `<input type="file">` that looks like a resume slot (via `DataTransfer`).

The popup (toolbar icon) shows recent applications and gives the same actions.

The toolbar icon also shows a green badge with the number of fresh tier-1
discovery leads (trusted sources, posted in the last 24h) — refreshed every
30 minutes via `chrome.alarms`. Review them at `http://localhost:3001/discover`.

## Architecture

```
extension/
├── manifest.json          MV3 manifest
├── background.js          Service worker — talks to the backend
├── lib/
│   ├── api.js             Authenticated fetch wrapper
│   └── storage.js         chrome.storage.sync wrapper + tab-state cache
├── content/
│   ├── content.js         Injected on every page — detects, mounts widget,
│   │                      fills forms, drives resume upload
│   └── content.css        Widget styling
├── popup/                 Toolbar popup
└── options/               Settings page
```

The backend additions are:

- `src/middleware.ts` — adds CORS for `/api/*` from extension origins; the
  route handlers authenticate `Authorization: Bearer yolo_…` per-user tokens
  (hashed in the DB, managed in Settings → Credentials). Same-origin web-app
  calls authenticate through the Clerk session instead.
- `src/lib/answerQuestion.ts` — LLM call that drafts a free-text form answer
  constrained to the candidate's facts.
- `src/app/api/extract-job/dom/route.ts` — accepts `{ text, url }` from the
  extension (bypasses server-side scraping which LinkedIn blocks).
- `src/app/api/answer-question/route.ts` — exposes the answerQuestion lib.
- `src/app/api/profile/route.ts` — read-only profile fields for autofill.

Nothing in the extension touches the web app's UI code; nothing in the web app
imports from the extension. You can delete the entire `extension/` directory
and the Next.js app keeps working.

## What it does NOT do

- **Click submit on your behalf.** Captchas and ToS surfaces matter — review
  the prefilled form, then submit yourself.
- **Read across origins outside the active tab.** No background scraping of
  other tabs.
- **Persist anything sensitive in `chrome.storage.sync` besides the backend
  URL + your API token.** All applications, contacts, and resumes live in the
  YOLOapply database / storage bucket. Revoke the token any time from
  Settings → Credentials.
