// Guidance returned by the get_browser_application_playbook tool. The MCP
// server never touches employer sites: the agent fills forms in a browser the
// candidate can watch, and records outcomes back here. Generic for every user;
// candidate facts come from get_application_context, never from this text.

export const GENERAL_STEPS = [
  "1. Before opening the form: get_application_context (with the company) and check_duplicate_application. Stop if a confirmed submission already exists. Then create_application_draft BEFORE opening the form: the draft is the claim, so a second agent working the same candidate sees the job as taken.",
  "2. Read the LIVE job description (get_job checks Greenhouse/Lever/Ashby liveness by default; refreshLive re-fetches the text, or read the page itself). Cached text can be headings only; listing salary is never verified. If the posting is closed, removed or no longer accepting applications, stop and, for a catalog job, call set_job_availability with available=false and what you saw as evidence. If the live title, URL or description differs from the draft, fix it with update_application_draft before preparing the resume.",
  "3. prepare_resume, then poll get_resume_status until completed (30-75 s; progress.pollAfterSeconds says when). Fetch it with get_resume_file: delivery=local_file gives a path for the browser's file input when this server runs on the same machine, otherwise use downloadUrl or base64. Check it is one page and every fact is in the saved profile/projects.",
  "4. Upload the resume FIRST and wait until the site has finished parsing it (spinner gone, fields populated, upload shown as complete). Record record_application_attempt stage=resume_parsed.",
  "5. Read back every field the parser touched or left empty. Pass them to review_form_fields with displayedValue and, when verified, persistedValue. Correct ONLY fields it marks fill/correct; leave correct parser output alone.",
  "6. Persistence is not display. After typing: blur the field, then read the value back (input value, the selected option in the control, hidden input, or the site's validation). A typed search term in a combobox is not a selection: choose a real option from the site's own list. Never construct option objects or location payloads yourself.",
  "7. Parsers commonly overwrite current company with a past employer and clear selected locations. Fix the employer from saved answers, then select location LAST from the site's real suggestions.",
  "8. ask_candidate / review_sensitive / no_matching_option fields: use a saved answer only if one exists; otherwise ask the candidate. While waiting, call set_pending_questions with the open questions (the application stays parked and list_applications needsInput=true finds it) and continue with another job. When the candidate answers, save_candidate_answer with their own words so no later application asks again, then set_pending_questions with an empty list. Optional demographics stay blank unless saved.",
  "9. Before submitting, review every required field once more, and read visible validation errors. Do not bypass CAPTCHA, logins or bot checks; hand those to the candidate.",
  "10. A click is an attempt, not an application. After clicking submit, wait for a confirmation page/text or the form's success state. Record record_confirmed_submission ONLY with what you observed (confirmation text, page title/URL).",
  "11. If the browser disconnects, the page changes without a clear result, or validation is ambiguous after the click: record_application_attempt stage=submit_clicked outcome=unknown, then search_application_emails for a receipt. Retry only when you have positive evidence the submission did not go through.",
  "12. If the employer says you already applied, do not count it as new: record_confirmed_submission evidenceKind=employer_duplicate_notice with the ORIGINAL date from the original receipt (originalReceiptMessageId) or the employer's portal.",
  "13. If the site sends a verification code: note the time you triggered it, then get_application_otp with that requestedAt. Use the code once. Never use a code from a bank, account recovery or another employer. On kind=none, read the rejected reasons before asking the candidate for the code.",
  "14. If the employer rejects the submission as possible spam or bot traffic, do not retry or work around it: record_application_attempt stage=submit_clicked outcome=blocked with the message, check search_application_emails for a receipt, and leave the job for the candidate to submit by hand.",
  "15. At the end, list_applications with activitySince = when you started, for the summary: what was confirmed, what is parked with pendingQuestions, and what failed.",
];

export const ATS_NOTES: Record<string, string[]> = {
  greenhouse: [
    "React select inputs accept search text without selecting. Open the menu, click the real option, then confirm the control shows it as selected.",
    "Education school lists may lack the exact institution; use only a fallback the candidate has saved/approved.",
    "Some boards send an email verification code before final submit; use get_application_otp.",
  ],
  lever: [
    "Wait for both the upload success state and résumé parsing; parsing can replace current company and clear location.",
    "Location lookup reacts to keyboard events. If typing shows no suggestions, retry typing slowly; select a returned suggestion.",
    "Success is the /thanks page ('Application submitted').",
  ],
  ashby: [
    "Displayed values can differ from persisted form state: type and blur each required field individually.",
    "After submit, look for the success state or a definite validation error before doing anything else.",
  ],
  workday: ["Usually needs an account login; hand login and any CAPTCHA to the candidate."],
  eightfold: [
    "Eightfold-hosted careers sites (often on the employer's own domain, so pass atsProvider=eightfold) first create a candidate account and email a verification code from the employer's careers name via eightfold.ai; get_application_otp matches it on the employer's core name.",
    "After verification the site builds a profile from the resume ('bootstrapping'); wait for it, then review every imported field like any parser output.",
  ],
  turbohire: [
    "TurboHire forms (sometimes on the employer's own domain, so pass atsProvider=turbohire) are multi-step. 'Next' on the last step can submit the application without a separate Submit button: review every field BEFORE pressing Next on what may be the final step.",
    "Success is a 'Thank you for applying' page; record it as site_confirmation.",
  ],
  generic: ["Follow the general steps. Inspect validation messages and network results before retrying a click."],
};

/** ATS from an application URL, including boards the shared detector doesn't know. */
export function playbookProviderFromUrl(url: string): string | undefined {
  const u = url.toLowerCase();
  if (/eightfold\.ai/.test(u)) return "eightfold";
  if (/turbohire\.co/.test(u)) return "turbohire";
  return undefined;
}

export function playbook(atsProvider?: string) {
  const key = atsProvider && ATS_NOTES[atsProvider] ? atsProvider : "generic";
  return {
    principle:
      "Resume-parsing first: upload, let the site parse, then correct only missing or wrong values against saved facts, verifying each correction persisted. Never claim a submission without observed evidence.",
    steps: GENERAL_STEPS,
    atsProvider: key,
    atsNotes: ATS_NOTES[key],
    neverDo: [
      "Submit through this MCP server (it has no submit tool by design).",
      "Send outbound email.",
      "Invent answers, dates, employers, option values or location objects.",
      "Bypass CAPTCHA, logins or anti-bot checks.",
      "Retry a submission whose outcome is unknown before reconciling it.",
    ],
  };
}
