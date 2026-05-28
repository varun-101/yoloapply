// Content script — runs on every page. Detects whether the page is a job
// posting (so we can save it) and/or an application form (so we can autofill
// it). Adds a small floating widget.

(() => {
  if (window.__yoloapply_loaded) return;
  window.__yoloapply_loaded = true;

  // ---- backend bridge ----
  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => resolve(resp ?? { ok: false, error: "no response" }));
      } catch (e) {
        resolve({ ok: false, error: e?.message ?? String(e) });
      }
    });
  }

  // ---- detection ----
  function pageText() {
    // Strip nav/footer noise, then collapse whitespace.
    const clone = document.body?.cloneNode(true);
    if (!clone) return "";
    clone.querySelectorAll("script, style, nav, header, footer, noscript").forEach((n) => n.remove());
    return (clone.innerText || "").replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  const JOB_HINTS = /(job|career|opening|role|opportunit|position|hiring|apply|requirements|responsibilities|qualifications)/i;
  const FORM_HINTS = /(application|first.?name|last.?name|why .* (us|company)|tell us|salary|expected|cover letter|resume|cv)/i;
  function looksLikeJobPosting() {
    const t = pageText();
    if (t.length < 400) return false;
    return JOB_HINTS.test(t);
  }
  function findApplicationForms() {
    const forms = Array.from(document.querySelectorAll("form"));
    const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
    const text = (document.title + " " + pageText()).slice(0, 4000);
    if (!FORM_HINTS.test(text) && inputs.length < 3) return [];
    return forms.length ? forms : [document.body];
  }

  // ---- field discovery ----
  function cleanLabel(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .replace(/[••]/g, "")
      .replace(/\s*\*\s*$/, "") // strip trailing required-marker
      .replace(/\s*\(optional\)\s*$/i, "")
      .trim();
  }
  function looksLikeLabel(text) {
    if (!text) return false;
    const t = text.trim();
    if (t.length === 0 || t.length > 120) return false;
    if (/\n.*\n/.test(t)) return false; // multi-line paragraph
    return true;
  }
  function labelFor(el) {
    // 1. Linked label
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && looksLikeLabel(lab.innerText)) return cleanLabel(lab.innerText);
    }
    // 2. Ancestor label
    const enclosing = el.closest("label");
    if (enclosing && looksLikeLabel(enclosing.innerText)) return cleanLabel(enclosing.innerText);
    // 3. aria
    const aria = el.getAttribute("aria-label");
    if (aria) return cleanLabel(aria);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const node = document.getElementById(labelledBy);
      if (node && looksLikeLabel(node.innerText)) return cleanLabel(node.innerText);
    }
    // 4. Walk up the DOM looking for the nearest preceding label-like text.
    //    Many forms wrap label and input in separate divs at multiple nesting levels.
    let current = el;
    for (let depth = 0; depth < 5; depth++) {
      const parent = current.parentElement;
      if (!parent) break;
      // Look at children of `parent` that appear BEFORE `current` in document order.
      for (const sib of Array.from(parent.children)) {
        if (sib === current || sib.contains(el)) break;
        // Prefer explicit label-ish tags first
        const isLabelLike = /^(label|legend)$/i.test(sib.tagName);
        const text = (sib.innerText || "").trim();
        if (!text) continue;
        if (isLabelLike && looksLikeLabel(text)) return cleanLabel(text);
        // Otherwise accept short text-looking blocks too
        if (looksLikeLabel(text) && text.length <= 80 && !/^\s*$/.test(text)) {
          return cleanLabel(text);
        }
      }
      current = parent;
    }
    // 5. Fall back to placeholder / name / id
    return cleanLabel(el.placeholder || el.name || el.id || "");
  }
  function fieldKey(el) {
    return ((el.name || "") + " " + (el.id || "") + " " + labelFor(el)).toLowerCase();
  }
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  function fillableInputs() {
    return Array.from(document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=checkbox]):not([type=radio]), textarea, select"
    )).filter((el) => !el.disabled && !el.readOnly && isVisible(el));
  }

  // ---- profile-based matching ----
  // Ordered if-chain: most specific patterns first, generic "name" fallback LAST
  // so a field labeled "First Name" wins firstName before the catch-all `\bname\b`.
  function valueForKey(key, profile) {
    if (/\b(first.?name|given.?name|fname)\b/.test(key)) return profile.firstName;
    if (/\b(last.?name|family.?name|surname|lname)\b/.test(key)) return profile.lastName;
    if (/\bemail\b/.test(key)) return profile.email;
    if (/\b(phone|mobile|cell|telephone|contact.?number|whatsapp)\b/.test(key)) return profile.phone;
    if (/\bgithub\b/.test(key)) return profile.github;
    if (/\blinkedin\b/.test(key)) return profile.linkedin;
    if (/\b(portfolio|personal.?(site|website)|website|web.?site|personal.?url)\b/.test(key)) return profile.portfolio;
    if (/\b(years?\W?of\W?(experience|exp)|total\W?(years?|experience|exp)|yoe|^experience$|experience\W*\(years\))\b/.test(key))
      return profile.yearsOfExperience;
    if (/\b(current.?(role|title|position|designation)|job.?title|present.?role|present.?designation|designation)\b/.test(key))
      return profile.currentRole;
    if (/\b(current.?(company|employer|organi[sz]ation)|present.?(company|employer|organi[sz]ation)|employer|organi[sz]ation\W*\(current\))\b/.test(key))
      return profile.currentCompany;
    if (/\b(city|town)\b/.test(key)) return profile.city;
    if (/\b(country|nationality)\b/.test(key)) return profile.country;
    if (/\b(current.?location|location|address|where.?are.?you|where.?do.?you.?live|preferred.?location|present.?location|residential.?city|residential.?location)\b/.test(key))
      return profile.location;
    if (/\b(school|university|college|institution|institute)\b/.test(key)) return profile.education?.school;
    if (/\b(degree|qualification|major|highest.?qualification)\b/.test(key)) return profile.education?.degree;
    // Generic name fallback — runs LAST so first/last fields don't get swallowed.
    if (/\bname\b/.test(key)) return profile.fullName;
    return null;
  }

  // ---- DOM helpers ----
  function setNativeValue(el, value) {
    const tag = el.tagName;
    const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function selectByText(el, value) {
    const v = value.toLowerCase();
    for (const opt of el.options ?? []) {
      if (opt.text.toLowerCase().includes(v) || opt.value.toLowerCase() === v) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }
  function glow(el) {
    el.classList.add("yolo-fill-glow");
    setTimeout(() => el.classList.remove("yolo-fill-glow"), 1200);
  }

  // ---- the fillers ----
  async function fillBasicFields(profile) {
    const inputs = fillableInputs();
    let filled = 0;
    const debugMisses = [];
    for (const el of inputs) {
      if (el.value && el.value.trim()) continue; // don't overwrite user edits
      const key = fieldKey(el);
      const tag = el.tagName;
      if (tag === "SELECT") continue; // handled in second pass
      const v = valueForKey(key, profile);
      if (v) {
        setNativeValue(el, String(v));
        glow(el);
        filled++;
      } else if (key.trim()) {
        debugMisses.push(key.trim().slice(0, 80));
      }
    }
    for (const el of document.querySelectorAll("select")) {
      if (!isVisible(el) || el.disabled) continue;
      if (el.value && el.value.trim()) continue;
      const key = fieldKey(el);
      const v = valueForKey(key, profile);
      if (v && selectByText(el, String(v))) {
        glow(el);
        filled++;
      }
    }
    if (debugMisses.length) console.log("[YOLOapply] no-match fields:", debugMisses);
    return filled;
  }

  // Free-text questions that we can't fill from profile: send to backend LLM.
  // Uses a dummy profile of all "x" so valueForKey returns truthy if the key
  // matches any profile pattern — those are the fields we should NOT treat as
  // free-text questions.
  const PROFILE_KEY_PROBE = {
    fullName: "x", firstName: "x", lastName: "x", email: "x", phone: "x",
    github: "x", linkedin: "x", portfolio: "x", currentRole: "x",
    currentCompany: "x", city: "x", country: "x", location: "x",
    yearsOfExperience: "x",
    education: { school: "x", degree: "x" },
  };
  async function answerOpenEndedQuestions({ jobDescription, company, role, applicationId }) {
    const isProfileField = (el) => !!valueForKey(fieldKey(el), PROFILE_KEY_PROBE);
    const textareas = Array.from(document.querySelectorAll("textarea")).filter(
      (el) => isVisible(el) && !el.disabled && !el.readOnly
    );
    // Also include longer text inputs that look question-y (label > 15 chars, no profile match).
    const longText = Array.from(document.querySelectorAll("input[type=text]")).filter((el) => {
      if (!isVisible(el) || el.disabled || el.readOnly || el.value) return false;
      const label = labelFor(el);
      if (label.length < 15) return false;
      return !isProfileField(el);
    });
    const targets = [...textareas, ...longText].filter((el) => !el.value || !el.value.trim());

    let answered = 0;
    for (const el of targets) {
      const label = labelFor(el).trim();
      if (!label) continue;
      const maxChars = (() => {
        const m = String(el.getAttribute("maxlength") || "").match(/\d+/);
        return m ? Number(m[0]) : undefined;
      })();
      const resp = await send({
        type: "answerQuestion",
        payload: { question: label, jobDescription, company, role, applicationId, maxChars },
      });
      if (resp?.ok && resp.answer?.answer) {
        setNativeValue(el, resp.answer.answer.slice(0, maxChars ?? 100000));
        glow(el);
        answered++;
      }
    }
    return answered;
  }

  // Upload resume PDF into the first file input that looks like a resume slot.
  async function uploadResume(appId) {
    const fileInputs = Array.from(document.querySelectorAll("input[type=file]")).filter(isVisible);
    if (!fileInputs.length) return 0;
    const blobResp = await send({ type: "resumeBlob", appId: appId ?? null });
    if (!blobResp?.ok) throw new Error(blobResp?.error ?? "couldn't fetch resume");
    const bytes = new Uint8Array(blobResp.bytes);
    const blob = new Blob([bytes], { type: blobResp.type || "application/pdf" });
    const file = new File([blob], "Varun_Chandwani_Resume.pdf", { type: "application/pdf" });

    let uploaded = 0;
    for (const input of fileInputs) {
      const key = fieldKey(input);
      const accept = (input.getAttribute("accept") || "").toLowerCase();
      const isResumeSlot = /resume|cv/.test(key) || (accept.includes("pdf") && fileInputs.length === 1);
      if (!isResumeSlot && fileInputs.length > 1) continue;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        glow(input);
        uploaded++;
      } catch (e) {
        // Some sites block programmatic file assignment; surface a friendly message.
        console.warn("[YOLOapply] couldn't assign file to input:", e);
      }
    }
    return uploaded;
  }

  // ---- the widget ----
  let widget;
  let statusEl;
  const state = { job: null, applicationId: null };

  function ui() {
    if (widget) return widget;
    widget = document.createElement("div");
    widget.id = "yoloapply-widget";
    widget.innerHTML = `
      <div class="yolo-head">
        <strong>YOLOapply</strong>
        <button class="yolo-close" title="Hide" aria-label="Hide widget">×</button>
      </div>
      <div class="yolo-body">
        <div class="yolo-row yolo-job"><span class="yolo-dot"></span><span class="yolo-jt">Detecting job posting…</span></div>
        <div class="yolo-row yolo-form"><span class="yolo-dot"></span><span class="yolo-ft">Detecting application form…</span></div>
        <button class="yolo-btn" data-act="save">Save job to dashboard</button>
        <button class="yolo-btn yolo-secondary" data-act="personalize" disabled>Personalize resume</button>
        <button class="yolo-btn yolo-secondary" data-act="fill">Auto-fill this form</button>
        <button class="yolo-btn yolo-secondary" data-act="answer">Answer open-ended questions (LLM)</button>
        <button class="yolo-btn yolo-secondary" data-act="resume">Upload resume PDF</button>
        <div class="yolo-status yolo-info yolo-hidden" data-role="status"></div>
        <div class="yolo-small">Tip: click the YOLOapply icon to open the popup.</div>
      </div>
    `;
    document.documentElement.appendChild(widget);

    widget.querySelector(".yolo-close").addEventListener("click", () => widget.classList.add("yolo-hidden"));
    statusEl = widget.querySelector('[data-role="status"]');
    widget.addEventListener("click", async (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      const btn = e.target;
      btn.disabled = true;
      try {
        if (act === "save") await onSave();
        else if (act === "personalize") await onPersonalize();
        else if (act === "fill") await onFill();
        else if (act === "answer") await onAnswer();
        else if (act === "resume") await onResume();
      } catch (err) {
        showStatus("err", err?.message ?? String(err));
      } finally {
        btn.disabled = false;
      }
    });
    return widget;
  }

  function showStatus(kind, msg) {
    if (!statusEl) return;
    statusEl.classList.remove("yolo-hidden", "yolo-ok", "yolo-err", "yolo-info");
    statusEl.classList.add(kind === "ok" ? "yolo-ok" : kind === "err" ? "yolo-err" : "yolo-info");
    statusEl.textContent = msg;
  }

  function setDetection({ isJob, isForm }) {
    if (!widget) return;
    widget.querySelector(".yolo-jt").textContent = isJob ? "Job posting detected" : "No job posting detected";
    widget.querySelector(".yolo-ft").textContent = isForm ? "Application form detected" : "No application form detected";
    widget.querySelector(".yolo-job").style.opacity = isJob ? "1" : "0.55";
    widget.querySelector(".yolo-form").style.opacity = isForm ? "1" : "0.55";
    widget.querySelector('[data-act="save"]').disabled = !isJob;
    widget.querySelector('[data-act="fill"]').disabled = !isForm;
    widget.querySelector('[data-act="answer"]').disabled = !isForm;
    widget.querySelector('[data-act="resume"]').disabled = !isForm;
  }

  // ---- actions ----
  async function onSave() {
    showStatus("info", "Extracting job description…");
    const text = pageText();
    const resp = await send({ type: "extractFromDom", text, url: location.href });
    if (!resp?.ok) throw new Error(resp?.error ?? "extraction failed");
    const job = resp.job;
    state.job = job;
    if (!job.company || !job.role) {
      showStatus("err", "Couldn't extract company or role. Try selecting the JD area and reloading the page.");
      return;
    }
    showStatus("info", `Saving "${job.role} @ ${job.company}"…`);
    const created = await send({
      type: "createApplication",
      payload: {
        company: job.company,
        role: job.role,
        location: job.location,
        source: job.source ?? "portal",
        jdUrl: location.href,
        jdText: job.jdText,
        applyUrl: job.applyUrl || location.href,
        personalize: false,
      },
    });
    if (!created?.ok) throw new Error(created?.error ?? "save failed");
    state.applicationId = created.created.id;
    widget.querySelector('[data-act="personalize"]').disabled = false;
    showStatus("ok", `Saved. Application ID: ${state.applicationId.slice(0, 10)}…`);
  }

  async function onPersonalize() {
    if (!state.applicationId) {
      showStatus("err", "Save the job first.");
      return;
    }
    showStatus("info", "Personalizing resume (this can take 30-60s)…");
    const r = await send({ type: "personalize", id: state.applicationId });
    if (!r?.ok) throw new Error(r?.error ?? "personalize failed");
    showStatus("ok", "Resume personalized. Use Upload resume PDF to attach it.");
  }

  async function onFill() {
    showStatus("info", "Filling basic fields from profile…");
    const p = await send({ type: "profile" });
    if (!p?.ok) throw new Error(p?.error ?? "couldn't load profile");
    const n = await fillBasicFields(p.profile);
    if (n === 0) {
      showStatus(
        "err",
        "No matching fields. Try 'Answer open-ended questions' for free-text fields, or check the console for the labels we saw."
      );
    } else {
      showStatus("ok", `Filled ${n} field${n === 1 ? "" : "s"}.`);
    }
  }

  async function onAnswer() {
    showStatus("info", "Answering open-ended questions with the LLM (slow)…");
    const job = state.job || {};
    const n = await answerOpenEndedQuestions({
      jobDescription: job.jdText,
      company: job.company,
      role: job.role,
      applicationId: state.applicationId,
    });
    showStatus(n ? "ok" : "info", n ? `Answered ${n} question${n === 1 ? "" : "s"}.` : "No open-ended questions found.");
  }

  async function onResume() {
    showStatus("info", "Uploading resume PDF…");
    const n = await uploadResume(state.applicationId);
    showStatus(n ? "ok" : "err", n ? `Uploaded into ${n} input${n === 1 ? "" : "s"}.` : "Couldn't find a resume file input.");
  }

  // ---- mount ----
  function mount() {
    if (location.protocol === "chrome:" || location.protocol === "chrome-extension:") return;
    const isJob = looksLikeJobPosting();
    const isForm = findApplicationForms().length > 0;
    if (!isJob && !isForm) return;
    ui();
    setDetection({ isJob, isForm });
  }

  // Re-evaluate on SPA navigations.
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(mount, 800);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial mount after page settle.
  setTimeout(mount, 400);
})();
