# Job Application Automation Agent — Codex Implementation Plan

## Objective

Upgrade the existing job-application platform into a unified application automation system that reduces tab switching, copy/paste work, recruiter discovery work, repetitive ATS form filling, recruiter outreach, and follow-up tracking.

The desired user experience is:

```text
Find a job
   ↓
Send/capture job into the platform
   ↓
Platform parses the opportunity
   ↓
Platform prepares:
- job analysis
- tailored resume
- recruiter/contact
- recruiter outreach email
- ATS application form
   ↓
Human review
   ↓
Apply + send recruiter email
   ↓
Track status and follow-ups
```

The system should automate preparation aggressively, but keep the final external actions reviewable.

---

# Codex Instructions

## Branch

Do all work on a separate feature branch.

Suggested branch:

```bash
git checkout -b feat/application-agent
```

Do not modify `main` directly.

Before implementation:

1. Inspect the repository.
2. Understand the current architecture.
3. Identify existing functionality for:
   - job ingestion
   - job parsing
   - resume generation
   - resume storage
   - application tracking
   - Playwright/browser automation
   - email generation
   - email sending
   - authentication
   - database models
4. Reuse existing abstractions wherever possible.
5. Avoid rewriting working features unnecessarily.
6. Create migrations instead of destructive schema changes.
7. Preserve current functionality.

Implement this incrementally.

---

# Core Product Goal

Convert the platform from a resume generator/application helper into an:

> Application Command Center

Each job opportunity should become a tracked workflow with discrete states.

Example:

```text
DISCOVERED
    ↓
JOB_PARSED
    ↓
MATCH_ANALYZED
    ↓
RESUME_GENERATED
    ↓
RECRUITER_SEARCHED
    ↓
RECRUITER_FOUND
    ↓
EMAIL_GENERATED
    ↓
APPLICATION_PREPARED
    ↓
READY_FOR_REVIEW
    ↓
APPLICATION_SUBMITTED
    ↓
OUTREACH_SENT
    ↓
FOLLOW_UP_PENDING
    ↓
REPLIED / REJECTED / INTERVIEW / CLOSED
```

Do not require every opportunity to pass through every state.

State transitions should be resumable.

---

# High-Level Architecture

```text
                    ┌──────────────────────┐
                    │ Browser Extension    │
                    │ / Job URL Input      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Job Ingestion API    │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
            Job Parser / LLM        Job Metadata
                    │
                    ▼
               Match Engine
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
 Resume Tailoring       Recruiter Discovery
          │                   │
          ▼                   ▼
    Resume PDF         Contact Resolution
          │                   │
          └─────────┬─────────┘
                    ▼
             Outreach Draft
                    │
                    ▼
          Application Preparation
                    │
                    ▼
              Human Review
                    │
          ┌─────────┴───────────┐
          ▼                     ▼
 ATS Submit Action          Gmail Send
          │                     │
          └─────────┬───────────┘
                    ▼
             Application Tracker
                    │
                    ▼
              Follow-up Engine
```

---

# Phase 1 — Unified Job Ingestion

## Goal

Allow a job to enter the platform with one action.

Current manual flow likely resembles:

```text
Job board
→ copy URL
→ open platform
→ paste URL
→ import
```

Replace this with:

```text
Job page
→ Send to Application Platform
```

---

## Browser Extension

If an extension already exists, extend it.

If not, add a minimal browser extension or bookmarklet-compatible ingestion path.

Preferred extension action:

```text
Send to Application Platform
```

The extension should capture:

```ts
type CapturedJob = {
  url: string;
  source?: string;

  title?: string;
  company?: string;
  location?: string;

  description?: string;

  capturedAt: string;
};
```

Do not rely entirely on client-side extraction.

The backend must be able to fetch/parse the URL independently when possible.

---

## Backend Endpoint

Suggested endpoint:

```http
POST /api/jobs/ingest
```

Example request:

```json
{
  "url": "https://example.com/jobs/123",
  "source": "linkedin",
  "title": "Backend Software Engineer",
  "company": "Example",
  "description": "..."
}
```

The backend should:

1. deduplicate by canonical URL
2. create/update an opportunity
3. parse job metadata
4. save raw description
5. trigger preparation workflow
6. return application/opportunity ID

---

# Phase 2 — Opportunity Model

Create a canonical opportunity/application record.

Adapt names to the existing database conventions.

Suggested model:

```ts
type Opportunity = {
  id: string;

  sourceUrl: string;
  source?: string;

  company: string;
  title: string;
  location?: string;

  rawDescription?: string;
  normalizedDescription?: string;

  status: ApplicationStatus;

  matchScore?: number;
  matchSummary?: string;

  recruiterId?: string;
  resumeId?: string;

  outreachDraftId?: string;

  applicationPreparedAt?: Date;
  submittedAt?: Date;
  outreachSentAt?: Date;

  followUpAt?: Date;

  createdAt: Date;
  updatedAt: Date;
};
```

---

# Phase 3 — Application State Machine

Use explicit states instead of scattered booleans.

Example:

```ts
type ApplicationStatus =
  | "DISCOVERED"
  | "JOB_PARSED"
  | "MATCH_ANALYZED"
  | "RESUME_GENERATED"
  | "RECRUITER_SEARCHED"
  | "RECRUITER_FOUND"
  | "EMAIL_GENERATED"
  | "APPLICATION_PREPARED"
  | "READY_FOR_REVIEW"
  | "APPLICATION_SUBMITTED"
  | "OUTREACH_SENT"
  | "FOLLOW_UP_PENDING"
  | "INTERVIEW"
  | "REJECTED"
  | "CLOSED"
  | "FAILED";
```

Also track individual task status separately.

Example:

```ts
type WorkflowTask = {
  key:
    | "PARSE_JOB"
    | "MATCH_JOB"
    | "GENERATE_RESUME"
    | "FIND_RECRUITER"
    | "GENERATE_OUTREACH"
    | "PREPARE_APPLICATION"
    | "SEND_OUTREACH";

  status:
    | "PENDING"
    | "RUNNING"
    | "SUCCESS"
    | "FAILED"
    | "SKIPPED";

  error?: string;

  startedAt?: Date;
  completedAt?: Date;
};
```

The pipeline must be resumable after failure.

---

# Phase 4 — Match Analysis

For each opportunity, compute a match analysis using the user's canonical profile.

Return structured output.

Example:

```json
{
  "score": 87,
  "strengths": [
    "Node.js backend experience",
    "PostgreSQL",
    "AWS deployment experience"
  ],
  "gaps": [
    "Role prefers Go"
  ],
  "recommendation": "APPLY"
}
```

Suggested categories:

```text
STRONG_MATCH
GOOD_MATCH
LOW_MATCH
NOT_ELIGIBLE
```

Do not fabricate missing experience.

---

# Phase 5 — Canonical Candidate Profile

Create one structured source of truth for all application automation.

Possible location:

```text
data/candidate-profile.json
```

or database equivalent.

Suggested schema:

```ts
type CandidateProfile = {
  personal: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    location?: string;
  };

  links: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };

  education: Array<{
    institution: string;
    degree: string;
    field?: string;
    startDate?: string;
    endDate?: string;
  }>;

  experience: Array<{
    company: string;
    title: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }>;

  applicationAnswers: {
    workAuthorization?: string;
    sponsorship?: string;
    noticePeriod?: string;
    willingToRelocate?: string;
    currentLocation?: string;
  };
};
```

IMPORTANT:

Never invent candidate answers.

If a value is missing, mark it as requiring review.

---

# Phase 6 — Tailored Resume Workflow

Reuse the existing resume generation system.

Each opportunity should produce a resume artifact linked to that opportunity.

Store:

```ts
type ResumeArtifact = {
  id: string;
  opportunityId: string;

  sourceVersion?: string;

  generatedText?: string;
  pdfPath?: string;

  createdAt: Date;
};
```

The generated resume must only contain facts supported by the candidate profile/project database.

No fabricated metrics, technologies, employers, positions, achievements, or project claims.

---

# Phase 7 — Recruiter Discovery

## Goal

Reduce this workflow:

```text
Search company
→ LinkedIn
→ find recruiter
→ open profile
→ SignalHire
→ retrieve email
```

into:

```text
Company
→ recruiter candidates
→ ranked recruiter
→ contact information
```

---

## Recruiter Search Interface

Implement a provider abstraction.

```ts
interface RecruiterProvider {
  searchRecruiters(input: {
    company: string;
    jobTitle?: string;
  }): Promise<RecruiterCandidate[]>;

  resolveContact?(
    candidate: RecruiterCandidate
  ): Promise<RecruiterContact | null>;
}
```

Do not couple the application directly to SignalHire.

Potential future providers may include:

```text
SignalHire
Hunter
Apollo
manual contact
company careers metadata
```

---

## Recruiter Candidate

```ts
type RecruiterCandidate = {
  id: string;

  name: string;
  title?: string;
  company?: string;

  linkedinUrl?: string;

  email?: string;
  phone?: string;

  provider: string;

  relevanceScore?: number;
  relevanceReason?: string;
};
```

---

## Ranking Logic

Suggested priority:

```text
1. Technical Recruiter
2. Engineering Recruiter
3. Talent Acquisition Partner — Engineering
4. Recruiter
5. Talent Acquisition
6. HR
```

Boost recruiter relevance if their title/domain matches:

```text
engineering
software
technology
product
technical
campus / graduate
```

depending on the role.

---

## Human Override

The user must be able to:

```text
Change Recruiter
Search Again
Enter Contact Manually
Skip Outreach
```

---

# Phase 8 — Outreach Drafting

After recruiter discovery, automatically draft recruiter outreach.

Input:

```text
candidate profile
job title
company
job description
resume
recruiter name
```

Output:

```ts
type OutreachDraft = {
  subject: string;
  body: string;

  recruiterId: string;
  opportunityId: string;

  status: "DRAFT" | "APPROVED" | "SENT";
};
```

The outreach message should be concise.

Suggested structure:

```text
Greeting

Applied for [Role]

1–2 relevant lines about experience

Why the role/company is relevant

Resume attached

Thanks
```

Never claim the recruiter posted the role unless that fact is actually known.

---

# Phase 9 — ATS Application Automation

Use Playwright.

Do NOT attempt a fully autonomous universal ATS agent initially.

Use adapter-based automation.

---

## ATS Adapter Interface

```ts
interface AtsAdapter {
  canHandle(url: string): boolean;

  prepare(input: {
    url: string;
    profile: CandidateProfile;
    resumePath: string;
  }): Promise<ApplicationPreparationResult>;
}
```

Create adapters over time.

Suggested priority:

```text
1. Greenhouse
2. Lever
3. Ashby
4. Workday
5. Generic HTML form
```

Only implement adapters appropriate to the URLs currently encountered in the repository/test data.

---

# Phase 10 — Form Field Mapping

Create a field normalization layer.

Examples:

```text
First name
Given name
Legal first name
→ firstName
```

```text
Are you legally authorized to work in India?
→ workAuthorization
```

Use:

1. known label mappings
2. DOM context
3. semantic/LLM fallback

Return confidence.

Example:

```ts
type FieldMapping = {
  selector: string;
  canonicalField?: string;

  value?: string;

  confidence: number;

  requiresHumanReview: boolean;
};
```

If confidence is below threshold:

```text
do not auto-answer
```

---

# Phase 11 — Sensitive / Dangerous Questions

Do not automatically answer questions involving:

```text
race
ethnicity
religion
gender
sexual orientation
disability
veteran status
criminal history
salary expectations
legal declarations
visa/work authorization when missing
conflict-of-interest declarations
background-check consent
```

These should be marked:

```text
REQUIRES_USER_INPUT
```

---

# Phase 12 — Application Preparation

The automation should fill fields but stop before final submission.

Desired user experience:

```text
Application prepared

Resume                ✓
Personal details       ✓
Education              ✓
Experience             ✓
Work authorization     ✓

Questions needing review: 2

[Open Review]
```

---

# Phase 13 — Review Screen

Create a central review screen.

Example:

```text
┌───────────────────────────────────────────┐
│ Example Corp                              │
│ Backend Software Engineer          91%    │
│                                           │
│ ✓ Job parsed                              │
│ ✓ Resume generated                        │
│ ✓ Recruiter found                         │
│ ✓ Outreach drafted                        │
│ ✓ Application prepared                    │
│                                           │
│ Recruiter                                 │
│ Jane Doe                                  │
│ Technical Recruiter                       │
│ jane@example.com                          │
│                                           │
│ Resume                                    │
│ backend_example_resume.pdf                │
│                                           │
│ Application Review                        │
│ 16 fields filled                          │
│ 2 fields need review                      │
│                                           │
│ [Resume] [Email] [Application]            │
│                                           │
│      APPLY + SEND OUTREACH                 │
└───────────────────────────────────────────┘
```

The exact UI should match existing styling.

---

# Phase 14 — Final Submission

Initially:

```text
DO NOT automatically submit without review.
```

The user should explicitly confirm:

```text
Submit Application
```

or:

```text
Apply + Send Outreach
```

Application submission and email sending should be separate actions internally even if exposed as one button.

This allows one to succeed if the other fails.

---

# Phase 15 — Gmail Integration

If Gmail OAuth already exists, reuse it.

Otherwise create a provider abstraction.

```ts
interface MailProvider {
  createDraft(input: MailInput): Promise<MailDraft>;

  send(input: MailInput): Promise<SentMail>;
}
```

Suggested structure:

```ts
type MailInput = {
  to: string;
  subject: string;
  body: string;

  attachments?: string[];
};
```

After sending:

store:

```text
provider message ID
thread ID
recipient
subject
timestamp
opportunity ID
```

---

# Phase 16 — Application Timeline

Each opportunity should have a timeline.

Example:

```text
Aug 10 14:01  Job imported
Aug 10 14:02  Match score: 91%
Aug 10 14:02  Resume generated
Aug 10 14:03  Recruiter found
Aug 10 14:03  Outreach drafted
Aug 10 14:05  Application prepared
Aug 10 14:08  Application submitted
Aug 10 14:09  Recruiter email sent
Aug 15 09:00  Follow-up due
```

Suggested event model:

```ts
type ApplicationEvent = {
  id: string;
  opportunityId: string;

  type: string;

  metadata?: Record<string, unknown>;

  createdAt: Date;
};
```

---

# Phase 17 — Follow-Up Engine

After outreach is sent:

```text
followUpAt = outreachSentAt + configurable delay
```

Default can be:

```text
5 days
```

Make this configurable.

Create states:

```text
NOT_REQUIRED
SCHEDULED
DUE
SENT
CANCELLED
```

A follow-up should be cancelled if:

```text
recruiter replied
application rejected
interview scheduled
application closed
```

---

# Phase 18 — Reply Classification

Future-friendly design:

When recruiter replies are available, classify them into:

```text
INTERVIEW
ASSESSMENT
REJECTION
REQUEST_INFO
FOLLOW_UP
OTHER
```

Do not make this phase block the MVP.

Implement interfaces/models so it can be added later.

---

# Phase 19 — Application Inbox

Add a page for prepared opportunities.

Example:

```text
Application Inbox

Strong Match
─────────────────────────────────────────────
BrowserStack — Backend Engineer       92%
Razorpay — SDE I                      89%
CRED — Backend Engineer               87%

Good Match
─────────────────────────────────────────────
...

Not Eligible
─────────────────────────────────────────────
...
```

Possible filters:

```text
All
Needs Review
Ready to Apply
Applied
Follow-up Due
Interview
Rejected
Failed
```

---

# Phase 20 — Batch Preparation

Support:

```text
Prepare Applications
```

for several jobs.

The expensive preparation work may run concurrently:

```text
Job A → resume + recruiter + email
Job B → resume + recruiter + email
Job C → resume + recruiter + email
```

Use sensible concurrency limits.

Do not overload external APIs.

---

# Phase 21 — Workflow Orchestrator

Do not put the entire workflow in one giant API route.

Create a job/workflow layer.

Possible structure:

```text
src/
  application-agent/
    ingest/
    matching/
    resume/
    recruiter/
    outreach/
    ats/
    workflow/
    followup/
```

Example orchestrator:

```ts
async function prepareApplication(opportunityId: string) {
  await parseJob(opportunityId);
  await analyzeMatch(opportunityId);

  await Promise.all([
    generateResume(opportunityId),
    findRecruiter(opportunityId),
  ]);

  await generateOutreach(opportunityId);
  await prepareAtsApplication(opportunityId);

  await markReadyForReview(opportunityId);
}
```

Do not use this exact structure if the repository already has a better domain organization.

---

# Phase 22 — Idempotency

All pipeline steps must be safe to retry.

Examples:

```text
Generating a resume twice must not create uncontrolled duplicates.

Sending outreach must never send twice accidentally.

Submitting an application must never retry automatically without verification.
```

Create idempotency keys for destructive external actions.

Example:

```text
outreach-send:{opportunityId}
application-submit:{opportunityId}
```

---

# Phase 23 — Audit Log

Log every important automated action.

Examples:

```text
JOB_IMPORTED
JOB_PARSED
MATCH_COMPUTED
RESUME_GENERATED
RECRUITER_SEARCH_STARTED
RECRUITER_FOUND
OUTREACH_GENERATED
ATS_FORM_PREPARED
APPLICATION_SUBMITTED
OUTREACH_SENT
FOLLOWUP_SCHEDULED
ERROR
```

This is essential for debugging agents.

---

# Phase 24 — Error Handling

Each pipeline step should report actionable failures.

Bad:

```text
Something went wrong.
```

Good:

```text
Recruiter discovery failed:
SignalHire returned no contacts for Example Corp.
```

Example UI:

```text
Recruiter discovery        Failed

No matching recruiter was found.

[Search Again]
[Enter Recruiter Manually]
[Skip]
```

---

# Phase 25 — Provider Interfaces

Keep external integrations behind interfaces.

Suggested:

```text
RecruiterProvider
MailProvider
ResumeGenerator
JobParser
LLMProvider
AtsAdapter
```

This keeps the product independent from individual vendors.

---

# Phase 26 — Security

Never log secrets.

Protect:

```text
SignalHire API key
Gmail OAuth tokens
LLM API keys
session tokens
ATS credentials
```

Use existing secret management patterns.

Do not commit:

```text
.env
OAuth tokens
API keys
browser profiles
cookies
```

---

# Phase 27 — Browser Session Safety

For Playwright:

Do not store raw browser cookies unless required.

If persistent sessions are required, place them outside git and document setup.

Never expose browser profiles through APIs.

---

# Phase 28 — External Automation Guardrails

Do not build scraping behavior that attempts to bypass:

```text
CAPTCHAs
rate limits
login protections
anti-bot systems
access controls
```

If automation hits a CAPTCHA:

```text
PAUSE AND REQUEST USER ACTION
```

Do not build CAPTCHA bypassing.

---

# Phase 29 — Human Review Rules

The following require human confirmation:

```text
final job application submission
sending recruiter outreach
answers not present in candidate profile
low-confidence ATS mappings
sensitive demographic questions
salary answers
legal declarations
free-text application questions that introduce new claims
```

---

# Phase 30 — Confidence Thresholds

For AI-derived field mappings:

Example:

```text
confidence >= 0.95
→ auto-fill

0.75–0.95
→ fill but highlight for review

< 0.75
→ require user input
```

Make thresholds configurable.

---

# Phase 31 — UI Components

Likely required UI elements:

```text
OpportunityCard
ApplicationStatusBadge
MatchScore
RecruiterCard
ResumePreview
OutreachEditor
ApplicationReview
WorkflowTimeline
FailureCard
ApplicationInbox
```

Follow the repository's existing component system.

---

# Phase 32 — Main Dashboard

The primary page should make application state obvious.

Suggested card:

```text
Example Corp
Backend Engineer

Match: 91%

Resume            ✓
Recruiter         ✓
Email             ✓
Application       Ready

[Review & Apply]
```

Avoid exposing implementation details to users.

---

# Phase 33 — Search / Filtering

Support searching by:

```text
company
role
recruiter
status
source
```

Filters:

```text
Ready
Needs Review
Applied
Follow-up
Interview
Rejected
Failed
```

---

# Phase 34 — CLI / Internal Debug Commands

If the project has scripts, add developer commands for individual workflow stages.

Examples:

```bash
pnpm job:parse <id>
pnpm job:match <id>
pnpm job:resume <id>
pnpm job:recruiter <id>
pnpm job:prepare <id>
```

Adapt to the repo's package manager.

These should be development/debugging tools.

---

# Phase 35 — Testing

Add tests for:

```text
job ingestion
URL deduplication
state transitions
resume association
recruiter ranking
recruiter provider
outreach generation
field normalization
ATS mappings
idempotency
follow-up scheduling
failure recovery
```

For browser automation:

use fixture HTML instead of live ATS pages wherever possible.

Example fixtures:

```text
tests/fixtures/greenhouse.html
tests/fixtures/lever.html
tests/fixtures/ashby.html
```

---

# Phase 36 — Mock External Providers

Testing must not consume paid API credits.

Create mock providers:

```text
MockRecruiterProvider
MockMailProvider
MockLLMProvider
MockAtsAdapter
```

Allow development mode to run entirely without external services.

---

# Phase 37 — Observability

Add structured logging.

Example:

```json
{
  "event": "RECRUITER_FOUND",
  "opportunityId": "abc",
  "provider": "signalhire",
  "durationMs": 824
}
```

Track durations for:

```text
job parsing
match generation
resume generation
recruiter discovery
application preparation
```

---

# Phase 38 — MVP Scope

The first usable MVP should accomplish:

```text
Job captured
    ↓
Job parsed
    ↓
Match analyzed
    ↓
Resume generated
    ↓
Recruiter suggested
    ↓
Recruiter email resolved
    ↓
Outreach generated
    ↓
Everything displayed in one review screen
```

ATS automation can be added immediately after this if it does not already exist.

---

# Phase 39 — MVP Acceptance Criteria

The MVP is complete when the user can:

1. import a job from a URL
2. see the parsed company/title/description
3. see a match score
4. generate a tailored resume
5. retrieve recruiter candidates
6. choose/change recruiter
7. obtain recruiter contact information when supported
8. generate an outreach email
9. view all artifacts on one page
10. retry failed workflow steps
11. manually override automatically selected data

---

# Phase 40 — ATS Acceptance Criteria

ATS automation is complete when:

1. a supported job portal is detected
2. known profile fields are filled automatically
3. resume is uploaded
4. unmapped fields are surfaced for review
5. sensitive questions are not guessed
6. low-confidence answers are highlighted
7. the user can review all fields
8. the application is not submitted without confirmation
9. failures are resumable

---

# Phase 41 — Outreach Acceptance Criteria

Recruiter outreach is complete when:

1. recruiter candidate is associated with opportunity
2. contact email is stored
3. message is generated
4. user can edit message
5. resume can be attached
6. sending requires explicit action
7. provider message ID is stored
8. duplicate sending is prevented

---

# Phase 42 — Follow-Up Acceptance Criteria

Follow-up functionality is complete when:

1. a follow-up date can be scheduled
2. application shows when follow-up is due
3. user can generate follow-up text
4. follow-up can be marked sent
5. it can be cancelled
6. status changes can cancel it automatically later

---

# Recommended Implementation Order

Do not attempt everything at once.

## Milestone 1

```text
Opportunity state machine
+
Application Command Center
```

## Milestone 2

```text
One-click job ingestion
+
browser extension integration
```

## Milestone 3

```text
Automated resume preparation
+
match analysis
```

## Milestone 4

```text
Recruiter provider abstraction
+
SignalHire integration
+
recruiter ranking
```

## Milestone 5

```text
Outreach generation
+
Gmail integration
```

## Milestone 6

```text
Playwright ATS adapters
```

## Milestone 7

```text
Follow-ups
+
reply/status tracking
```

## Milestone 8

```text
Batch preparation
+
Application Inbox
```

---

# Codex Execution Strategy

Before writing code:

```text
1. Inspect repo.
2. Produce a short architecture assessment.
3. Map existing functionality to this document.
4. Identify which parts already exist.
5. Implement Milestone 1 first.
6. Run tests/build/lint.
7. Commit logical changes.
8. Continue milestone-by-milestone.
```

Do not rebuild functionality that already exists.

Where this document conflicts with established repository patterns, preserve the repository pattern unless it compromises the product requirements.

---

# Suggested Commits

Example:

```text
feat(applications): add opportunity workflow state machine

feat(applications): add application command center

feat(extension): add one-click job capture

feat(recruiters): add recruiter provider interface

feat(recruiters): add SignalHire integration

feat(outreach): add recruiter outreach workflow

feat(ats): add ATS adapter framework

feat(ats): add greenhouse adapter

feat(followup): add application follow-up scheduling
```

Keep commits coherent.

---

# Definition of Done

The project is successful when the normal job-application workflow changes from:

```text
browse job
copy URL
switch apps
generate resume
search LinkedIn
find recruiter
use SignalHire
copy email
switch back
apply
switch Gmail
paste recruiter
paste email
attach resume
send
update tracker
```

to approximately:

```text
Find job

↓ one action

Application prepared

↓ review

Apply + Send

↓ automatically tracked
```

The user's time should be spent deciding:

```text
Should I apply?
```

and:

```text
Is this application correct?
```

not moving information between tools.

---

# Important Product Principle

Automate information movement and preparation aggressively.

Keep irreversible external actions deliberate.

That means:

```text
AUTO:
- parsing
- matching
- resume tailoring
- recruiter ranking
- contact lookup
- outreach drafting
- form filling
- tracking
- follow-up preparation

REVIEW:
- uncertain fields
- sensitive questions
- recruiter selection when ambiguous
- generated free-text claims

EXPLICIT USER ACTION:
- submit application
- send recruiter email
```

This principle should guide all implementation decisions.
