// Thin wrapper around chrome.storage.sync for the extension's settings.

export const DEFAULTS = Object.freeze({
  apiBase: "http://localhost:3001",
  apiKey: "",
  autoDetectJob: true,
  showWidget: true,
  showShortcuts: true,
});

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (items) => resolve({ ...DEFAULTS, ...items }));
  });
}

export async function saveSettings(patch) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(patch, () => resolve());
  });
}

// Per-tab volatile cache (keyed by tabId) for the last extracted JD, so the
// popup, content, and background can share state without re-extracting.
export async function setTabState(tabId, state) {
  const key = `tab:${tabId}`;
  return new Promise((resolve) => chrome.storage.session.set({ [key]: state }, resolve));
}
export async function getTabState(tabId) {
  const key = `tab:${tabId}`;
  return new Promise((resolve) =>
    chrome.storage.session.get(key, (items) => resolve(items?.[key] ?? null))
  );
}
export async function clearTabState(tabId) {
  const key = `tab:${tabId}`;
  return new Promise((resolve) => chrome.storage.session.remove(key, resolve));
}

// ---- Q&A history (persists across popup open/close in chrome.storage.local) ----
const QA_KEY = "qaHistory";
const QA_MAX = 50;

export async function getQaHistory() {
  return new Promise((resolve) =>
    chrome.storage.local.get({ [QA_KEY]: [] }, (items) => resolve(items[QA_KEY] ?? []))
  );
}

async function setQaHistory(list) {
  return new Promise((resolve) => chrome.storage.local.set({ [QA_KEY]: list.slice(0, QA_MAX) }, resolve));
}

// Insert a new pending entry at the front. Returns the entry id.
export async function pushQaEntry(entry) {
  const list = await getQaHistory();
  const id = `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const full = { id, status: "pending", createdAt: Date.now(), ...entry };
  await setQaHistory([full, ...list]);
  return id;
}

// Merge a patch into an existing entry by id.
export async function updateQaEntry(id, patch) {
  const list = await getQaHistory();
  const next = list.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await setQaHistory(next);
}

export async function deleteQaEntry(id) {
  const list = await getQaHistory();
  await setQaHistory(list.filter((e) => e.id !== id));
}

export async function clearQaHistory() {
  await setQaHistory([]);
}

// ---- saved-job cache (survives page refresh / browser restart) ----
// Maps a normalized page URL -> { applicationId, company, role, job, savedAt }.
const SAVED_KEY = "savedJobs";
const SAVED_MAX = 200;

export function normalizeJobUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

export async function getSavedJob(url) {
  const key = normalizeJobUrl(url);
  return new Promise((resolve) =>
    chrome.storage.local.get({ [SAVED_KEY]: {} }, (items) => resolve(items[SAVED_KEY]?.[key] ?? null))
  );
}

export async function setSavedJob(url, data) {
  const key = normalizeJobUrl(url);
  return new Promise((resolve) =>
    chrome.storage.local.get({ [SAVED_KEY]: {} }, (items) => {
      const map = items[SAVED_KEY] ?? {};
      map[key] = { ...data, savedAt: Date.now() };
      // Prune oldest entries if the map grows too large.
      const keys = Object.keys(map);
      if (keys.length > SAVED_MAX) {
        keys
          .sort((a, b) => (map[a].savedAt ?? 0) - (map[b].savedAt ?? 0))
          .slice(0, keys.length - SAVED_MAX)
          .forEach((k) => delete map[k]);
      }
      chrome.storage.local.set({ [SAVED_KEY]: map }, resolve);
    })
  );
}
