// Popup script — uses chrome.runtime to talk to background, and
// chrome.scripting/messaging to drive the active tab's content script.

import { getSettings, saveSettings, getQaHistory, deleteQaEntry, clearQaHistory } from "../lib/storage.js";

const $ = (sel) => document.querySelector(sel);
const conn = $('[data-role="conn"]');
const statusEl = $('[data-role="status"]');
const appsEl = $('[data-role="apps"]');

function setStatus(kind, msg) {
  statusEl.classList.remove("hidden", "ok", "err", "info");
  statusEl.classList.add(kind);
  statusEl.textContent = msg;
}

function bg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r ?? { ok: false, error: "no response" })));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function tellContent(msg) {
  const tab = await activeTab();
  return new Promise((resolve) => chrome.tabs.sendMessage(tab.id, msg, (r) => resolve(r ?? null)));
}

// Best-effort: grab the active tab's visible text + a company/role guess to use
// as job context for a pasted question. Returns {} on pages we can't script.
async function grabPageContext() {
  const tab = await activeTab();
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/i.test(tab.url ?? "")) return {};
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clone = document.body?.cloneNode(true);
        if (clone) clone.querySelectorAll("script,style,nav,header,footer,noscript").forEach((n) => n.remove());
        const text = (clone?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 8000);
        const og = document.querySelector('meta[property="og:site_name"]')?.content;
        const company = (og || (document.title || "").split(/[|\-–—:]/)[0]).trim();
        return { text, company: company.length > 1 && company.length < 60 ? company : "" };
      },
    });
    return res?.result ?? {};
  } catch {
    return {};
  }
}

// Sends a runAction message to the content script. If the content script
// isn't loaded on this tab (some pages block document_idle injection, or the
// extension was just reloaded), inject it on demand, then retry.
async function triggerContentButton(act) {
  const tab = await activeTab();
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/i.test(tab.url ?? "")) {
    throw new Error("This page can't be scripted. Open a real job/application page.");
  }

  const sendOnce = () =>
    new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: "runAction", act }, (resp) => {
        if (chrome.runtime.lastError) resolve({ __noReceiver: true, error: chrome.runtime.lastError.message });
        else resolve(resp ?? { ok: false, error: "no response" });
      });
    });

  let resp = await sendOnce();
  if (resp?.__noReceiver) {
    // Content script not present — inject it, then retry once.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content/content.css"] });
    } catch {}
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] });
    await new Promise((r) => setTimeout(r, 300));
    resp = await sendOnce();
    if (resp?.__noReceiver) throw new Error("Couldn't load the helper on this page.");
  }
  if (resp && resp.ok === false && resp.error) throw new Error(resp.error);
  return resp;
}

async function paintConnection() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    conn.textContent = "API token missing — open Options";
    return;
  }
  const r = await bg({ type: "ping" });
  conn.textContent = r?.ok ? "connected" : `offline: ${r?.error ?? "?"}`;
}

async function paintApps() {
  const r = await bg({ type: "listApplications" });
  if (!r?.ok) {
    appsEl.innerHTML = `<li class="muted">${(r?.error ?? "couldn't load")}</li>`;
    return;
  }
  const apps = r.apps.slice(0, 8);
  if (!apps.length) {
    appsEl.innerHTML = `<li class="muted">No applications yet.</li>`;
    return;
  }
  appsEl.innerHTML = apps
    .map(
      (a) => `<li>
        <div class="row">
          <div class="ttl" title="${a.role} @ ${a.company}">${escapeHtml(a.company)}</div>
          <span class="badge ${a.status}">${a.status}</span>
        </div>
        <div class="row sub">
          <span class="ttl">${escapeHtml(a.role)}</span>
          <a href="${getDashboardLink(a.id)}" target="_blank">open</a>
        </div>
      </li>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let dashboardBase = "http://localhost:3001";
async function loadDashboardBase() {
  const s = await getSettings();
  dashboardBase = s.apiBase || dashboardBase;
}
function getDashboardLink(id) {
  return `${dashboardBase.replace(/\/$/, "")}/applications/${id}`;
}

document.addEventListener("click", async (e) => {
  const act = e.target?.dataset?.act;
  if (!act) return;
  try {
    if (act === "settings") {
      await chrome.runtime.openOptionsPage();
    } else if (act === "dashboard") {
      await loadDashboardBase();
      chrome.tabs.create({ url: dashboardBase });
    } else if (act === "save") {
      setStatus("info", "Saving the current job…");
      await triggerContentButton("save");
      setStatus("ok", "Done — check the widget on the page.");
      setTimeout(() => paintApps(), 1200);
    } else if (act === "personalize") {
      setStatus("info", "Personalizing resume (30-60s)… keep this open.");
      await triggerContentButton("personalize");
      setStatus("ok", "Done — check the widget on the page.");
    } else if (act === "fill") {
      setStatus("info", "Filling fields…");
      await triggerContentButton("fill");
      setStatus("ok", "Done — check the widget on the page.");
    } else if (act === "answer") {
      setStatus("info", "Answering open-ended questions (slow)… keep this open.");
      await triggerContentButton("answer");
      setStatus("ok", "Done — check the widget on the page.");
    } else if (act === "resume") {
      setStatus("info", "Uploading resume PDF…");
      await triggerContentButton("resume");
      setStatus("ok", "Done — check the widget on the page.");
    } else if (act === "cover") {
      setStatus("info", "Generating cover letter (slow)… keep this open.");
      await triggerContentButton("cover");
      setStatus("ok", "Done — check the widget on the page.");
    } else if (act === "qa-generate") {
      await generateAnswer(e.target);
    } else if (act === "qa-clear") {
      await clearQaHistory();
    } else if (act === "qa-copy") {
      await copyText(e.target, e.target.dataset.text || "");
    } else if (act === "qa-del") {
      await deleteQaEntry(e.target.dataset.id);
    } else if (act === "toggle-shortcuts") {
      await toggleShortcuts();
    }
  } catch (err) {
    setStatus("err", err?.message ?? String(err));
  }
});

// ---- keyboard shortcuts ----
let shortcutsOn = true;

function applyShortcutsUi() {
  document.body.classList.toggle("show-shortcuts", shortcutsOn);
  const btn = document.querySelector('[data-act="toggle-shortcuts"]');
  if (btn) btn.classList.toggle("active", shortcutsOn);
}

async function toggleShortcuts() {
  shortcutsOn = !shortcutsOn;
  applyShortcutsUi();
  await saveSettings({ showShortcuts: shortcutsOn });
}

// Click the action button bound to a single-letter key.
function runKey(key) {
  const btn = document.querySelector(`.actions button[data-key="${key}"]:not([disabled])`);
  if (btn) {
    btn.click();
    return true;
  }
  return false;
}

document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd+Enter inside the question box generates an answer.
  const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && e.target?.dataset?.role === "qa-input") {
    e.preventDefault();
    const gen = document.querySelector('[data-act="qa-generate"]');
    if (gen) gen.click();
    return;
  }
  // Don't hijack typing.
  if (inField) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === "?") {
    e.preventDefault();
    void toggleShortcuts();
    return;
  }
  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k) && runKey(k)) {
    e.preventDefault();
  }
});

// ---- manual Q&A (persistent history) ----
const qaInput = $('[data-role="qa-input"]');
const qaList = $('[data-role="qa-list"]');
const qaUsePage = $('[data-role="qa-usepage"]');

function escapeHtmlText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderQaList(list) {
  if (!qaList) return;
  if (!list.length) {
    qaList.innerHTML = "";
    return;
  }
  qaList.innerHTML = list
    .map((e) => {
      const q = escapeHtmlText(e.question);
      let bodyHtml;
      if (e.status === "pending") {
        bodyHtml = `<div class="pending"><span class="spinner"></span> Generating…</div>`;
      } else if (e.status === "error") {
        bodyHtml = `<div class="err">${escapeHtmlText(e.error || "failed")}</div>`;
      } else {
        bodyHtml = `<div class="a readonly-box">${escapeHtmlText(e.answer)}</div>`;
      }
      const conf = e.status === "done" && e.confidence ? `confidence: ${escapeHtmlText(e.confidence)}` : "";
      const note = e.status === "done" && e.note ? `<div class="note">${escapeHtmlText(e.note)}</div>` : "";
      const copyBtn =
        e.status === "done"
          ? `<button data-act="qa-copy" data-text="${escapeHtmlText(e.answer)}">Copy</button>`
          : "";
      return `<li class="qa-item" data-id="${e.id}">
        <div class="q">${q}</div>
        ${bodyHtml}
        ${note}
        <div class="meta">
          <span class="conf">${conf}</span>
          <span class="btns">
            ${copyBtn}
            <button data-act="qa-del" data-id="${e.id}">Delete</button>
          </span>
        </div>
      </li>`;
    })
    .join("");
}

async function paintQa() {
  const list = await getQaHistory();
  renderQaList(list);
}

async function generateAnswer(btn) {
  const question = (qaInput?.value ?? "").trim();
  if (!question) {
    setStatus("err", "Paste a question first.");
    return;
  }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Sending…";
  setStatus("info", "Generating in the background — you can switch tabs.");
  try {
    let jobDescription;
    let company;
    if (qaUsePage?.checked) {
      const ctx = await grabPageContext();
      jobDescription = ctx.text || undefined;
      company = ctx.company || undefined;
    }
    const r = await bg({ type: "qaGenerate", payload: { question, jobDescription, company } });
    if (!r?.ok) throw new Error(r?.error ?? "failed");
    qaInput.value = "";
    // The pending entry is now in storage; storage.onChanged re-renders.
    setStatus("ok", "Working… the answer will appear below when ready.");
  } catch (err) {
    setStatus("err", err?.message ?? String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function copyText(btn, text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const orig = btn.textContent;
  btn.textContent = "Copied ✓";
  setTimeout(() => (btn.textContent = orig), 1200);
}

// Live-update the history whenever the background writes to it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.qaHistory) {
    renderQaList(changes.qaHistory.newValue ?? []);
  }
});

(async () => {
  const settings = await getSettings();
  shortcutsOn = settings.showShortcuts !== false;
  applyShortcutsUi();
  await loadDashboardBase();
  await paintQa();
  await paintConnection();
  await paintApps();
})();
