// Thin wrapper around chrome.storage.sync for the extension's settings.

export const DEFAULTS = Object.freeze({
  apiBase: "http://localhost:3001",
  apiKey: "",
  autoDetectJob: true,
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
