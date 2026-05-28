// Popup script — uses chrome.runtime to talk to background, and
// chrome.scripting/messaging to drive the active tab's content script.

import { getSettings } from "../lib/storage.js";

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

// Triggers the content-script button by id.
async function triggerContentButton(act) {
  const tab = await activeTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (action) => {
      const btn = document.querySelector(`#yoloapply-widget [data-act="${action}"]`);
      if (btn) btn.click();
      else alert("Open a job application or job posting first, then try again.");
    },
    args: [act],
  });
}

async function paintConnection() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    conn.textContent = "API key missing — open Options";
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
      setTimeout(() => paintApps(), 1200);
    } else if (act === "personalize") {
      setStatus("info", "Personalizing resume (30-60s)…");
      await triggerContentButton("personalize");
    } else if (act === "fill") {
      setStatus("info", "Filling fields…");
      await triggerContentButton("fill");
    } else if (act === "answer") {
      setStatus("info", "Answering open-ended questions…");
      await triggerContentButton("answer");
    } else if (act === "resume") {
      setStatus("info", "Uploading resume PDF…");
      await triggerContentButton("resume");
    }
  } catch (err) {
    setStatus("err", err?.message ?? String(err));
  }
});

(async () => {
  await loadDashboardBase();
  await paintConnection();
  await paintApps();
})();
