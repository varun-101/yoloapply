// Background service worker. Routes messages between the popup and content
// script and brokers calls to the backend.
import { api, fetchResumeBlob } from "./lib/api.js";
import { getSettings, getTabState, setTabState } from "./lib/storage.js";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

// Click the extension icon → open the popup (default behavior).
// On install we also open the options page so the user can paste an API key.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const tabId = sender?.tab?.id ?? msg?.tabId;
      switch (msg?.type) {
        case "settings": {
          sendResponse({ ok: true, settings: await getSettings() });
          return;
        }
        case "ping": {
          await api.ping();
          sendResponse({ ok: true });
          return;
        }
        case "extractFromDom": {
          const job = await api.extractFromDom(msg.text, msg.url);
          if (tabId) await setTabState(tabId, { job, url: msg.url });
          sendResponse({ ok: true, job });
          return;
        }
        case "createApplication": {
          const created = await api.createApplication(msg.payload);
          sendResponse({ ok: true, created });
          return;
        }
        case "personalize": {
          const result = await api.personalize(msg.id);
          sendResponse({ ok: true, result });
          return;
        }
        case "listApplications": {
          const apps = await api.listApplications();
          sendResponse({ ok: true, apps });
          return;
        }
        case "profile": {
          const p = await api.profile();
          sendResponse({ ok: true, profile: p });
          return;
        }
        case "answerQuestion": {
          const a = await api.answerQuestion(msg.payload);
          sendResponse({ ok: true, answer: a });
          return;
        }
        case "resumeBlob": {
          const blob = await fetchResumeBlob(msg.appId);
          const ab = await blob.arrayBuffer();
          sendResponse({ ok: true, bytes: Array.from(new Uint8Array(ab)), type: blob.type });
          return;
        }
        case "tabState": {
          const tid = msg.tabId ?? tabId;
          sendResponse({ ok: true, state: tid ? await getTabState(tid) : null });
          return;
        }
        default:
          sendResponse({ ok: false, error: `unknown message type: ${msg?.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message ?? String(e) });
    }
  })();
  return true; // keep the channel open for async sendResponse
});
