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

  // ---- saved-job cache (survives page refresh) ----
  // Keyed by normalized URL in chrome.storage.local so a saved application is
  // restored when the same job page is reloaded.
  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.hash = "";
      return u.toString();
    } catch {
      return url;
    }
  }
  function getSavedJob() {
    const key = normalizeUrl(location.href);
    return new Promise((resolve) =>
      chrome.storage.local.get({ savedJobs: {} }, (items) => resolve(items.savedJobs?.[key] ?? null))
    );
  }
  // Saving is persisted by the background service worker (chrome.storage.local),
  // so it survives this content script unloading. We only read here.

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
    // Includes the autocomplete attribute (Layer 0) so standard tokens like
    // "given-name" / "family-name" / "email" / "tel" / "organization" match.
    return (
      (el.name || "") +
      " " +
      (el.id || "") +
      " " +
      (el.getAttribute("autocomplete") || "") +
      " " +
      labelFor(el)
    ).toLowerCase();
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

  // ---- Layer 2: collect remaining empty fields + apply the LLM mapping ----
  function collectEmptyFields() {
    const out = [];
    let i = 0;
    for (const el of fillableInputs()) {
      const isSelect = el.tagName === "SELECT";
      // Skip already-filled text fields and already-chosen selects.
      if (!isSelect && el.value && el.value.trim()) continue;
      if (isSelect && el.selectedIndex > 0 && el.value) continue;
      const id = el.dataset.yoloId || `yf_${i++}_${Math.random().toString(36).slice(2, 6)}`;
      el.dataset.yoloId = id;
      out.push({
        id,
        label: labelFor(el),
        name: el.name || "",
        type: isSelect ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.type || "text",
        placeholder: el.placeholder || "",
        autocomplete: el.getAttribute("autocomplete") || "",
        maxLength: el.maxLength > 0 ? el.maxLength : undefined,
        options: isSelect
          ? Array.from(el.options)
              .map((o) => o.text.trim())
              .filter((t) => t && !/^\s*(select|choose|please|--)/i.test(t))
          : undefined,
      });
    }
    return out;
  }

  function applyMapped(mapped) {
    let filled = 0;
    for (const m of mapped || []) {
      if (!m || m.kind === "skip" || !m.value) continue;
      let el;
      try {
        el = document.querySelector(`[data-yolo-id="${CSS.escape(m.id)}"]`);
      } catch {
        el = null;
      }
      if (!el) continue;
      if (el.tagName === "SELECT") {
        if (el.selectedIndex > 0 && el.value) continue;
        if (selectByText(el, String(m.value))) {
          glow(el);
          filled++;
        }
      } else {
        if (el.value && el.value.trim()) continue;
        const max = el.maxLength > 0 ? el.maxLength : 100000;
        setNativeValue(el, String(m.value).slice(0, max));
        glow(el);
        filled++;
      }
    }
    return filled;
  }

  // ---- the widget ----
  let widget;
  let statusEl;
  const state = { job: null, applicationId: null };

  // ---- drag / resize / position memory ----
  // Default anchor is top-right (CSS). Dragging the header moves the widget;
  // the native CSS resize handle (bottom-right corner) resizes it. Both are
  // remembered in chrome.storage.local so the widget stays put across pages.
  const BOX_KEY = "widgetBox";

  function applyBox(el, box) {
    const width = Math.min(box.width ?? el.offsetWidth, window.innerWidth - 16);
    const left = Math.max(8, Math.min(box.left, window.innerWidth - 90));
    const top = Math.max(8, Math.min(box.top, window.innerHeight - 56));
    el.style.left = left + "px";
    el.style.top = top + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    if (box.width) el.style.width = width + "px";
    if (box.height) el.style.height = Math.min(box.height, window.innerHeight - 16) + "px";
  }

  function saveBox(el, includeSize) {
    const r = el.getBoundingClientRect();
    chrome.storage.local.get(BOX_KEY, (items) => {
      const prev = items?.[BOX_KEY] ?? {};
      const next = { ...prev, left: r.left, top: r.top };
      if (includeSize) {
        next.width = r.width;
        next.height = r.height;
      }
      chrome.storage.local.set({ [BOX_KEY]: next });
    });
  }

  function initWidgetBox(el) {
    chrome.storage.local.get(BOX_KEY, (items) => {
      const box = items?.[BOX_KEY];
      if (box && typeof box.left === "number" && typeof box.top === "number") applyBox(el, box);
    });

    const head = el.querySelector(".yolo-head");
    let drag = null;
    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".yolo-close")) return;
      const r = el.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      // Switch from right-anchored to left/top so movement math is direct.
      el.style.left = r.left + "px";
      el.style.top = r.top + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    head.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const left = Math.max(0, Math.min(drag.left + e.clientX - drag.x, window.innerWidth - 90));
      const top = Math.max(0, Math.min(drag.top + e.clientY - drag.y, window.innerHeight - 48));
      el.style.left = left + "px";
      el.style.top = top + "px";
      drag.moved = true;
    });
    const endDrag = () => {
      if (drag?.moved) saveBox(el, false);
      drag = null;
    };
    head.addEventListener("pointerup", endDrag);
    head.addEventListener("pointercancel", endDrag);

    // Native CSS resize fires no event, and the browser swallows the pointerup
    // on the element while resizing — so record the size on pointerdown and
    // compare on the next window-level pointerup (capture phase sees it).
    let sizeAtDown = null;
    el.addEventListener("pointerdown", () => {
      sizeAtDown = { w: el.offsetWidth, h: el.offsetHeight };
    });
    window.addEventListener(
      "pointerup",
      () => {
        if (sizeAtDown && (el.offsetWidth !== sizeAtDown.w || el.offsetHeight !== sizeAtDown.h)) {
          saveBox(el, true);
        }
        sizeAtDown = null;
      },
      true
    );
  }

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
        <button class="yolo-btn yolo-secondary" data-act="cover">Cover letter (copy + upload)</button>
        <button class="yolo-btn yolo-secondary" data-act="resume">Upload resume PDF</button>
        <div class="yolo-status yolo-info yolo-hidden" data-role="status"></div>
        <div class="yolo-small">Tip: click the YOLOapply icon to open the popup.</div>
      </div>
    `;
    document.documentElement.appendChild(widget);
    initWidgetBox(widget);

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
        else if (act === "cover") await onCoverLetter();
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
    // Buttons are NOT hard-gated on detection — detection is often wrong on
    // custom portals. The actions themselves report when nothing was found.
    // Only "personalize" stays gated, since it needs a saved application.
    widget.querySelector('[data-act="personalize"]').disabled = !state.applicationId;
  }

  // ---- actions ----
  // Fire-and-forget: the background worker extracts + creates the application and
  // persists the result. We don't await the whole chain, so switching tabs or
  // navigating away no longer aborts the save.
  async function onSave() {
    const text = pageText();
    if (text.length < 200) {
      showStatus("err", "Not enough text on this page to extract a job posting.");
      return;
    }
    showStatus("info", "Extracting & saving in the background…");
    const resp = await send({ type: "saveJob", text, url: location.href });
    if (!resp?.ok) throw new Error(resp?.error ?? "couldn't start the save");
    showStatus("info", "Saving… you can switch tabs; it finishes in the background.");
  }

  // Apply a saved-job record (saving | saved | error) to the widget + state.
  function reflectSaved(saved) {
    if (!saved) return;
    if (saved.status === "saving") {
      showStatus("info", "Saving job in the background…");
    } else if (saved.status === "saved" && saved.applicationId) {
      state.applicationId = saved.applicationId;
      state.job = saved.job || { company: saved.company, role: saved.role };
      markSaved(saved.company, saved.role);
      showStatus("ok", `Saved "${saved.role || ""} @ ${saved.company || ""}".`);
    } else if (saved.status === "error") {
      showStatus("err", "Save failed: " + (saved.error || "unknown error"));
    }
  }

  // Reflect a saved application in the widget (button label + enabled actions).
  function markSaved(company, role) {
    const saveBtn = widget?.querySelector('[data-act="save"]');
    if (saveBtn) saveBtn.textContent = "Saved ✓ — re-save";
    const personalize = widget?.querySelector('[data-act="personalize"]');
    if (personalize) personalize.disabled = false;
    void company;
    void role;
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
    // Layer 0/1 — instant, offline: autocomplete attr + regex heuristics.
    showStatus("info", "Filling known fields…");
    const p = await send({ type: "profile" });
    if (!p?.ok) throw new Error(p?.error ?? "couldn't load profile");
    const heur = await fillBasicFields(p.profile);

    // Layer 2 — batch the still-empty fields to the LLM (handles any format,
    // selects, and open-ended questions in one request).
    const fields = collectEmptyFields();
    let ai = 0;
    if (fields.length) {
      showStatus("info", `Filled ${heur} instantly. Asking the LLM to map ${fields.length} more…`);
      const job = state.job || {};
      const resp = await send({
        type: "autofillMap",
        payload: {
          fields,
          jobDescription: job.jdText || pageText().slice(0, 8000),
          company: job.company || guessCompanyFromPage(),
          role: job.role,
          applicationId: state.applicationId,
        },
      });
      if (!resp?.ok) throw new Error(resp?.error ?? "autofill mapping failed");
      ai = applyMapped(resp.fields);
    }

    const total = heur + ai;
    if (total === 0) {
      showStatus("err", "Couldn't fill anything here. Check the console for the fields we saw.");
    } else {
      showStatus("ok", `Filled ${total} field${total === 1 ? "" : "s"} (${heur} instant, ${ai} via LLM).`);
    }
  }

  async function onAnswer() {
    showStatus("info", "Answering open-ended questions with the LLM (slow)…");
    const job = state.job || {};
    // If no job was saved/extracted, fall back to the visible page text so the
    // LLM still has the role's context (the candidate "about me" context is
    // always injected server-side from the profile + project bank).
    const jdText = job.jdText || pageText().slice(0, 8000);
    const n = await answerOpenEndedQuestions({
      jobDescription: jdText,
      company: job.company || guessCompanyFromPage(),
      role: job.role,
      applicationId: state.applicationId,
    });
    showStatus(
      n ? "ok" : "info",
      n
        ? `Answered ${n} question${n === 1 ? "" : "s"}.`
        : "No open-ended questions (textareas / long text fields) found on this page."
    );
  }

  // Best-effort company guess from the page title / og:site_name when we haven't
  // run a full extraction.
  function guessCompanyFromPage() {
    const og = document.querySelector('meta[property="og:site_name"]')?.content;
    if (og) return og.trim();
    const t = (document.title || "").split(/[|\-–—:]/)[0].trim();
    return t.length > 1 && t.length < 60 ? t : undefined;
  }

  async function onResume() {
    showStatus("info", "Uploading resume PDF…");
    const n = await uploadResume(state.applicationId);
    showStatus(n ? "ok" : "err", n ? `Uploaded into ${n} input${n === 1 ? "" : "s"}.` : "Couldn't find a resume file input.");
  }

  async function onCoverLetter() {
    if (!state.applicationId) {
      showStatus("err", "Save the job to the dashboard first, then generate the cover letter.");
      return;
    }
    showStatus("info", "Generating a tailored cover letter (30-60s)…");
    const r = await send({ type: "coverLetter", id: state.applicationId });
    if (!r?.ok) throw new Error(r?.error ?? "cover letter generation failed");

    // Copy the text so it can be pasted into a textarea.
    const copied = await copyToClipboard(r.text || "");
    // If a textarea looks like a cover-letter field, fill it directly.
    const filled = fillCoverLetterTextarea(r.text || "");
    // Upload the PDF into a cover-letter file slot if present.
    const uploaded = await uploadCoverLetter(state.applicationId);

    const bits = [];
    if (filled) bits.push("filled the cover-letter field");
    if (uploaded) bits.push(`uploaded PDF to ${uploaded} input${uploaded === 1 ? "" : "s"}`);
    if (copied) bits.push("copied to clipboard");
    showStatus("ok", "Cover letter ready — " + (bits.join(", ") || "saved to dashboard") + ".");
  }

  function fillCoverLetterTextarea(text) {
    if (!text) return 0;
    const tas = Array.from(document.querySelectorAll("textarea")).filter(
      (el) => isVisible(el) && !el.disabled && !el.readOnly && (!el.value || !el.value.trim())
    );
    let n = 0;
    for (const el of tas) {
      if (/cover.?letter|motivation|why.*(join|work|company)|message to.*(hiring|recruiter)/i.test(fieldKey(el))) {
        setNativeValue(el, text);
        glow(el);
        n++;
      }
    }
    return n;
  }

  async function uploadCoverLetter(appId) {
    const fileInputs = Array.from(document.querySelectorAll("input[type=file]")).filter(isVisible);
    if (!fileInputs.length) return 0;
    const target = fileInputs.find((i) => /cover|letter/.test(fieldKey(i)));
    if (!target) return 0; // don't clobber the resume slot
    const blobResp = await send({ type: "coverLetterBlob", appId });
    if (!blobResp?.ok) throw new Error(blobResp?.error ?? "couldn't fetch cover letter pdf");
    const bytes = new Uint8Array(blobResp.bytes);
    const file = new File([new Blob([bytes], { type: "application/pdf" })], "Varun_Chandwani_CoverLetter.pdf", {
      type: "application/pdf",
    });
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      target.files = dt.files;
      target.dispatchEvent(new Event("change", { bubbles: true }));
      glow(target);
      return 1;
    } catch {
      return 0;
    }
  }

  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  // Does the page have anything worth acting on?
  function hasActionableContent() {
    const fields = document.querySelectorAll(
      "input:not([type=hidden]), textarea, select"
    ).length;
    return looksLikeJobPosting() || findApplicationForms().length > 0 || fields >= 2;
  }

  // ---- mount ----
  // forceShow=true bypasses both the showWidget setting and content detection —
  // used when the user explicitly invokes an action from the popup.
  async function mount(forceShow = false) {
    if (location.protocol === "chrome:" || location.protocol === "chrome-extension:") return false;
    if (!forceShow) {
      const settings = await new Promise((resolve) =>
        chrome.storage.sync.get({ showWidget: true }, (items) => resolve(items))
      );
      if (settings.showWidget === false) return false;
      if (!hasActionableContent()) return false;
    }
    ui();
    if (widget.classList.contains("yolo-hidden")) widget.classList.remove("yolo-hidden");
    // Restore a previously-saved (or in-progress) application for this URL.
    if (!state.applicationId) {
      const saved = await getSavedJob();
      if (saved) reflectSaved(saved);
    }
    setDetection({ isJob: looksLikeJobPosting(), isForm: findApplicationForms().length > 0 });
    return true;
  }

  // Run an action by name, ensuring the widget exists first so status is visible.
  // This is the entry point the popup uses — it does NOT depend on detection.
  async function runAction(act) {
    await mount(true);
    const btn = widget?.querySelector(`[data-act="${act}"]`);
    if (btn) btn.disabled = true;
    try {
      if (act === "save") await onSave();
      else if (act === "personalize") await onPersonalize();
      else if (act === "fill") await onFill();
      else if (act === "answer") await onAnswer();
      else if (act === "cover") await onCoverLetter();
      else if (act === "resume") await onResume();
      else throw new Error(`unknown action: ${act}`);
      return { ok: true };
    } catch (err) {
      showStatus("err", err?.message ?? String(err));
      return { ok: false, error: err?.message ?? String(err) };
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Show / hide the widget. Mounts it first if it isn't on the page yet.
  async function toggleWidget() {
    if (!widget) {
      await mount(true);
      return true;
    }
    widget.classList.toggle("yolo-hidden");
    return !widget.classList.contains("yolo-hidden");
  }

  // Listen for direct action requests from the popup/background.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "runAction" && msg.act) {
      runAction(msg.act).then(sendResponse);
      return true; // async response
    }
    if (msg?.type === "showWidget") {
      mount(true).then((shown) => sendResponse({ ok: shown }));
      return true;
    }
    if (msg?.type === "toggleWidget") {
      toggleWidget().then((visible) => sendResponse({ ok: true, visible }));
      return true;
    }
    return false;
  });

  // Re-evaluate on SPA navigations.
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(mount, 800);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // React to setting + saved-job changes in real-time (no refresh needed).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (changes.showWidget) {
      if (changes.showWidget.newValue === false && widget) {
        widget.remove();
        widget = null;
        statusEl = null;
      } else if (changes.showWidget.newValue !== false && !widget) {
        setTimeout(mount, 200);
      }
    }
    // Background save finished/changed for this page → reflect it live.
    if (area === "local" && changes.savedJobs) {
      const saved = (changes.savedJobs.newValue || {})[normalizeUrl(location.href)];
      if (saved) reflectSaved(saved);
    }
  });

  // Initial mount after page settle.
  setTimeout(mount, 400);
})();
