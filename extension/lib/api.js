// Backend client. Reads {apiBase, apiKey} from storage on each call.
import { getSettings } from "./storage.js";

async function request(path, init = {}) {
  const { apiBase, apiKey } = await getSettings();
  if (!apiBase) throw new Error("Backend URL not configured. Open the extension Options.");
  if (!apiKey) throw new Error("API token not configured. Open the extension Options.");
  const url = apiBase.replace(/\/$/, "") + path;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === "string" ? data : data?.error ?? res.statusText;
    const e = new Error(`${res.status} ${msg}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

export const api = {
  ping: () => request("/api/profile"),
  profile: () => request("/api/profile"),
  extractFromDom: (text, url) =>
    request("/api/extract-job/dom", {
      method: "POST",
      body: JSON.stringify({ text, url }),
    }),
  createApplication: (payload) =>
    request("/api/applications", { method: "POST", body: JSON.stringify(payload) }),
  listApplications: () => request("/api/applications"),
  getApplication: (id) => request(`/api/applications/${id}`),
  personalize: (id) =>
    request(`/api/applications/${id}/personalize`, { method: "POST" }),
  setStatus: (id, status) =>
    request(`/api/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  answerQuestion: (payload) =>
    request("/api/answer-question", { method: "POST", body: JSON.stringify(payload) }),
  autofillMap: (payload) =>
    request("/api/autofill-map", { method: "POST", body: JSON.stringify(payload) }),
  coverLetter: (id) => request(`/api/applications/${id}/cover-letter`, { method: "POST" }),
  resumeInfo: () => request("/api/resume"),
  freshLeads: () => request("/api/discovery/leads?status=new&days=1"),
};

// Returns the resume PDF as a Blob — either the personalized PDF for `appId`
// or the generic resume.
export async function fetchResumeBlob(appId) {
  const { apiBase, apiKey } = await getSettings();
  const url = appId
    ? `${apiBase.replace(/\/$/, "")}/api/applications/${appId}/resume?format=pdf`
    : `${apiBase.replace(/\/$/, "")}/api/resume/file`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`${res.status} fetching resume`);
  return await res.blob();
}

// Returns the cover-letter PDF as a Blob for a given application.
export async function fetchCoverLetterBlob(appId) {
  const { apiBase, apiKey } = await getSettings();
  const url = `${apiBase.replace(/\/$/, "")}/api/applications/${appId}/cover-letter?format=pdf`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`${res.status} fetching cover letter`);
  return await res.blob();
}
