// Background service worker. Routes messages between the popup and content
// script and brokers calls to the backend.
import { api, fetchResumeBlob, fetchCoverLetterBlob } from "./lib/api.js";
import {
  getSettings,
  getTabState,
  setTabState,
  pushQaEntry,
  updateQaEntry,
  setSavedJob,
} from "./lib/storage.js";

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
        case "saveJob": {
          // Async, popup/content-independent: record a "saving" marker, respond
          // immediately, then extract + create the application in the background.
          // The result is persisted to chrome.storage.local (savedJobs[url]), and
          // the content script / popup reflect it via storage.onChanged — so it
          // survives the user switching tabs or navigating away mid-save.
          const { text, url } = msg;
          await setSavedJob(url, { status: "saving", startedAt: Date.now() });
          sendResponse({ ok: true, queued: true });
          (async () => {
            try {
              const job = await api.extractFromDom(text, url);
              if (!job.company || !job.role) {
                await setSavedJob(url, {
                  status: "error",
                  error: "Couldn't extract a company and role from this page.",
                });
                return;
              }
              const created = await api.createApplication({
                company: job.company,
                role: job.role,
                location: job.location,
                source: job.source ?? "portal",
                jdUrl: url,
                jdText: job.jdText,
                applyUrl: job.applyUrl || url,
                personalize: false,
              });
              await setSavedJob(url, {
                status: "saved",
                applicationId: created.id,
                company: job.company,
                role: job.role,
                job,
              });
            } catch (e) {
              await setSavedJob(url, { status: "error", error: e?.message ?? String(e) });
            }
          })();
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
        case "autofillMap": {
          const m = await api.autofillMap(msg.payload);
          sendResponse({ ok: true, fields: m.fields ?? [] });
          return;
        }
        case "qaGenerate": {
          // Persisted, popup-independent generation. Create a pending entry,
          // respond immediately with its id, then resolve in the background so
          // the result survives the popup closing.
          const { question, jobDescription, company, role } = msg.payload ?? {};
          const id = await pushQaEntry({ question, company: company ?? "" });
          sendResponse({ ok: true, id });
          // Fire-and-forget; storage.onChanged drives the popup UI.
          (async () => {
            try {
              const a = await api.answerQuestion({ question, jobDescription, company, role });
              await updateQaEntry(id, {
                status: "done",
                answer: a.answer ?? "",
                confidence: a.confidence ?? "",
                note: a.note ?? "",
              });
            } catch (err) {
              await updateQaEntry(id, { status: "error", error: err?.message ?? String(err) });
            }
          })();
          return;
        }
        case "resumeBlob": {
          const blob = await fetchResumeBlob(msg.appId);
          const ab = await blob.arrayBuffer();
          sendResponse({ ok: true, bytes: Array.from(new Uint8Array(ab)), type: blob.type });
          return;
        }
        case "coverLetter": {
          const r = await api.coverLetter(msg.id);
          sendResponse({ ok: true, text: r.text });
          return;
        }
        case "coverLetterBlob": {
          const blob = await fetchCoverLetterBlob(msg.appId);
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
