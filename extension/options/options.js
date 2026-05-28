import { getSettings, saveSettings, DEFAULTS } from "../lib/storage.js";

const $ = (s) => document.querySelector(s);
const status = $('[data-role="status"]');

function setStatus(kind, msg) {
  status.classList.remove("hidden", "ok", "err", "info");
  status.classList.add(kind);
  status.textContent = msg;
}

async function load() {
  const s = await getSettings();
  document.querySelector('[data-field="apiBase"]').value = s.apiBase ?? DEFAULTS.apiBase;
  document.querySelector('[data-field="apiKey"]').value = s.apiKey ?? "";
  document.querySelector('[data-field="autoDetectJob"]').checked = s.autoDetectJob !== false;
}

async function collect() {
  return {
    apiBase: document.querySelector('[data-field="apiBase"]').value.trim() || DEFAULTS.apiBase,
    apiKey: document.querySelector('[data-field="apiKey"]').value.trim(),
    autoDetectJob: document.querySelector('[data-field="autoDetectJob"]').checked,
  };
}

document.addEventListener("click", async (e) => {
  const act = e.target?.dataset?.act;
  if (!act) return;
  if (act === "save") {
    await saveSettings(await collect());
    setStatus("ok", "Saved.");
  } else if (act === "test") {
    setStatus("info", "Testing…");
    await saveSettings(await collect());
    const r = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: "ping" }, (resp) => resolve(resp ?? { ok: false, error: "no response" }))
    );
    if (r?.ok) setStatus("ok", "Connection looks good.");
    else setStatus("err", r?.error ?? "Failed.");
  }
});

load();
