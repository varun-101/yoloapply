# YOLOapply MCP server

Agents (Claude Code, Codex, T3 Code threads) use YOLOapply through a Model Context Protocol endpoint to find jobs, read the candidate's truthful profile and saved answers, prepare and download resumes, track applications and read application email. They fill in and submit employer forms in a separate browser the candidate can watch (for example the T3 collaborative browser). The MCP server has no tool that submits to an employer, sends email, deletes data or changes credentials.

## Endpoint

- `POST /api/mcp`, Streamable HTTP, **stateless** (no session id; JSON responses). `GET`/`DELETE` return 405.
- Protocol: `@modelcontextprotocol/sdk` 1.32 (protocol versions 2024-11-05 through 2025-11-25).
- Auth: `Authorization: Bearer yolo_...`, the personal API token from **Settings -> Credentials** (the same token the Chrome extension uses; only its sha256 is stored). Clerk cookies are not accepted here.
- Limits: 256 KB request body, batches of at most 20 messages, 240 calls per minute per user, 30 failed auth attempts per minute per IP, tool timeouts of 30-90 s, 200 K characters of output per call (larger results ask for a smaller `limit`).
- Errors come back as tool results with `isError: true` and `{ "error", "code" }`, for example `not_found` (also used for other users' ids), `no_llm_key`, `no_mailbox`, `cursor_filter_mismatch`, `timeout`.

## Running it locally

From the checkout that contains this file (never set `ENABLE_CRON=1` on a second instance):

```powershell
npm run build
$env:ENABLE_CRON = "0"; npx next start -p 3002 -H localhost
```

Use `-H localhost`, not `127.0.0.1`: Next 14's internal proxy resolves `localhost`, and a server bound only to 127.0.0.1 hangs on API routes. The dashboard keeps running on 3001 independently. Both servers can share one database: the Outlook refresh token is coordinated by a database lease (below).

## Client setup

The token is read from the environment variable `YOLOAPPLY_MCP_TOKEN`; never paste it into a config file or a command line.

```powershell
# Once per machine (user-level environment variable, new terminals pick it up)
[Environment]::SetEnvironmentVariable("YOLOAPPLY_MCP_TOKEN", "<paste the yolo_ token>", "User")
```

**Claude Code** (user scope):

```powershell
claude mcp add --transport http --scope user yoloapply http://localhost:3002/api/mcp --header 'Authorization: Bearer ${YOLOAPPLY_MCP_TOKEN}'
claude mcp list   # expect: yoloapply ... Connected
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.yoloapply]
url = "http://localhost:3002/api/mcp"
bearer_token_env_var = "YOLOAPPLY_MCP_TOKEN"
```

**T3 Code** threads use the Claude Code or Codex configuration of their provider.

Generating a new token in Settings replaces the old one, which also disconnects the Chrome extension until it gets the new token.

## Tools

| Area | Tool | Notes |
|---|---|---|
| Context | `get_account_status` | Setup readiness and mailbox connection. |
| | `get_application_context` | Profile, project bank, answer-preferences text (`UserPromptSetting.answers`), scoped saved answers (`UserProfile.applicationAnswers`) and declaration defaults resolved for a company. |
| | `get_browser_application_playbook` | Resume-parsing-first procedure plus ATS notes. |
| | `review_form_fields` | Compares observed form fields (displayed vs persisted) with saved facts; returns ok / ok_unverified / fill / correct / ask_candidate / review_sensitive / leave_optional / no_matching_option. Picks only real dropdown options. |
| Discovery | `search_jobs` | Keyset cursor over `COALESCE(postedAt, firstSeenAt)`; filters for source, location, title, company, job type, max experience, min fit score, recency, description presence; excludes or flags tracked applications by canonical URL, ATS posting id and company+title. |
| | `get_job_source_summary` | Per-source totals, undated and scored counts. |
| | `get_job` | Full description, provenance, salary disclosure (`verified` is always false), optional live refresh. |
| Tracking | `check_duplicate_application`, `list_applications`, `get_application` | `submissionState`: confirmed, unconfirmed_attempt, marked_applied_without_evidence, not_submitted. |
| | `create_application_draft` | From a catalog job or URL; deduplicates. |
| | `record_application_attempt` | Never marks applied. `submit_clicked` + `unknown` flags the application for receipt reconciliation. |
| | `record_confirmed_submission` | Evidence required (site confirmation, verified email receipt, employer duplicate notice with original date, or candidate confirmation). Idempotent under concurrency; the earliest evidenced date wins. |
| Resumes | `prepare_resume`, `get_resume_status`, `get_resume_file` | Background generation (joins a running one), status polling, base64 chunks with sha256. The same file is downloadable at `GET /api/applications/<id>/resume?download=1` with the same bearer header. |
| Mail | `get_mail_connection`, `search_application_emails`, `get_application_email`, `get_application_otp` | Outlook only, read-only. |

## Mail contract

Mail tools use the candidate's existing Outlook connection (Settings -> Credentials -> Connect Outlook, which grants `Mail.Read`). Gmail is not supported. Only `GET` requests reach Microsoft Graph, so nothing is sent, moved, deleted or marked read. Access tokens never leave the server.

- `search_application_emails` classifies mail as application_receipt, duplicate_notice, rejection, assessment, interview_or_next_steps, verification_code, job_alert, marketing, account_security or other, and matches it to tracked applications with `single`/`ambiguous`/`none` confidence. Received times are the mailbox's own.
- `get_application_email` returns plain text only for application mail (application categories, or `other` mail from a known ATS that names a tracked employer). Account-security, marketing and job-alert mail is refused. Any message that mentions a code (code, PIN, OTP, passcode, one-time, verify) has its preview and body WITHHELD in both search and read, and codes in its subject redacted. This fails closed on purpose: pattern redaction cannot be trusted with every code format. Codes are released only by `get_application_otp`.
- Receipts are classified from the subject and opening first, so job-alert footers don't hide them; "unfortunately" alone does not turn a receipt into a rejection. Mail from non-ATS senders mentioning banking/payments is treated as account security and hidden, which also hides receipts from banks hiring directly (fails closed).
- An email receipt counts for `record_confirmed_submission` only if this application is its single best match AND either the role is named or the mail arrived after tracking started. A duplicate notice without an original receipt id records the stated original date as unverified: it never pulls an existing `appliedAt` earlier.
- `coverageComplete: false` on a search means the listing was cut off; absence of a receipt is then not evidence.
- `get_application_otp` releases a code only for an application still being submitted (`draft`/`personalized`), only from mail received after the agent's `requestedAt` (at most 30 minutes), addressed to the candidate's mailbox, sent by the employer or a known ATS, naming the employer, containing exactly one code. Conflicting codes within 30 s are reported as ambiguous, as is any request while another application at the same employer had form activity in the last 30 minutes. Codes without any digit are not extracted (the candidate enters those). A code message used for one application is refused for any other. The event log stores a fingerprint of the message id, never the code.

This narrows the earlier rule that only the paired worker may receive run-scoped secrets: at the candidate's explicit request, an authenticated MCP client may receive an application verification code under the rules above. No other stored secret is exposed.

## Outlook refresh coordination

Microsoft rotates the refresh token on use. `getMicrosoftAccessToken` coalesces callers within a process and takes a database lease (`UserCredential.msRefreshLeaseOwner/msRefreshLeaseExpiresAt`) across processes, re-reads the credential under the lease, and only the lease holder that spent a token may store its successor. Migration `20261007120000_ms_refresh_lease` adds the columns with `IF NOT EXISTS`, so it is a no-op on databases that already have them.

## Declaration defaults

A candidate can save scoped "No" answers for two recurring declarations in `UserProfile.applicationAnswers.declarationDefaults`: `priorEmploymentAtHiringCompany` and `relativeInGovernment`, each `{ answer: "No", confirmedAt, confirmedBy: "candidate" }`, with optional `knownPastOrganizations`. They apply only to that candidate. A hiring company matching a saved past employer or listed organization never gets the default. They are never stretched to age, address, criminal history or other legal declarations. Settings -> Profile saves on this branch preserve this key (`mergeFormAnswers`). The local-browser auto-apply branch's profile route rebuilds `applicationAnswers` from a whitelist and would drop it; carry `declarationDefaults` through when merging that branch.

## Tests

- `npm test`: pure logic (posting identity, cursors, declarations, form review, mail classification, OTP selection, submission evidence, output/timeout guards).
- `npm run test:db`: integration tests against the disposable loopback database `yoloapply_mcp_test` (guarded by `scripts/mcp-test-db.mjs` and `tests/db/setup.ts`): official SDK client over the real handler, auth rejection, body limits, tenant isolation, cursor stability, concurrent submission recording, duplicate reconciliation, PATCH appliedAt, OTP binding and reuse, mail read refusal, and the two-process refresh lease.
