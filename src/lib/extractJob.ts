import { chatJson, llm, LLM_MODEL, parseJsonFromText } from "./llm";

export interface ExtractedJob {
  company: string;
  role: string;
  location?: string;
  jdText: string;
  applyUrl?: string;
  source?: "linkedin" | "portal" | "manual" | "cold_email";
}

const SYSTEM = `You extract structured job-application data from raw text scraped from a job posting (web page, screenshot OCR output, etc.). Be conservative — if a field is not clearly present in the text, leave it as an empty string. Never invent a company name, role, or URL.

Output STRICT JSON only — no prose, no markdown fences. Use this schema:

{
  "company": "string",
  "role": "string",
  "location": "string",
  "jdText": "string (the full cleaned job description — keep responsibilities, requirements, and benefits; drop nav, footer, cookie banners, 'apply now' buttons, repeated boilerplate)",
  "applyUrl": "string (only if a direct apply URL appears in the text — otherwise empty)",
  "source": "linkedin | portal"
}`;

function userPromptFor(rawText: string, hintUrl?: string): string {
  return `# RAW TEXT
"""
${rawText.slice(0, 24000)}
"""

${hintUrl ? `# SOURCE URL\n${hintUrl}\n` : ""}# TASK
Extract the structured job data per the schema. Pay attention:
- Company is usually near the top, in the page title, or in the URL/breadcrumbs.
- Role is the job title. Strip seniority modifiers only if the title is the company name (don't lose "Senior" / "Staff" / "Backend" — they matter).
- Location may be "Remote", a city, "Hybrid - <city>", etc.
- jdText: rewrite into clean paragraphs preserving meaning. Keep responsibilities, requirements, tech stack, benefits. Drop site chrome, repeated company-boilerplate paragraphs, and "Apply Now" CTAs.
- source: "linkedin" if the URL contains linkedin.com, otherwise "portal".`;
}

export async function extractFromText(rawText: string, hintUrl?: string): Promise<ExtractedJob> {
  const out = await chatJson<ExtractedJob>({
    system: SYSTEM,
    user: userPromptFor(rawText, hintUrl),
    maxTokens: 8192,
    temperature: 0.2,
  });
  return {
    company: out.company ?? "",
    role: out.role ?? "",
    location: out.location ?? "",
    jdText: out.jdText ?? "",
    applyUrl: out.applyUrl ?? hintUrl ?? "",
    source: out.source ?? (hintUrl?.includes("linkedin.com") ? "linkedin" : "portal"),
  };
}

// HTML → text: strip script/style, drop tags, collapse whitespace.
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/?(p|div|li|tr|br|h[1-6]|section|article|header|footer)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractFromUrl(url: string): Promise<ExtractedJob> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Couldn't fetch ${url} (HTTP ${res.status}). Many sites (LinkedIn, Workday) block server-side fetches — paste the JD text or upload a screenshot instead.`
    );
  }
  const html = await res.text();
  const text = htmlToText(html);
  if (text.length < 200) {
    throw new Error(
      "Fetched the page, but couldn't extract enough text. The page probably needs JS to render. Paste the JD or upload a screenshot."
    );
  }
  return extractFromText(text, url);
}

// Try DeepSeek vision (image_url content block). Fast path — works in 1-3 seconds
// when the model supports vision.
async function extractViaDeepSeekVision(buf: Buffer, mimeType: string): Promise<ExtractedJob> {
  const dataUrl = `data:${mimeType};base64,${buf.toString("base64")}`;
  const resp = await llm().chat.completions.create({
    model: LLM_MODEL,
    max_tokens: 8192,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Extract structured job data from this job-posting screenshot. " +
              "Follow the JSON schema in the system prompt exactly. " +
              "If the image is unreadable or not a job posting, return all empty strings.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const content = resp.choices[0]?.message?.content ?? "";
  if (!content) {
    const finish = resp.choices[0]?.finish_reason ?? "unknown";
    throw new Error(`vision model returned empty content (finish_reason=${finish})`);
  }
  const out = parseJsonFromText<ExtractedJob>(content);
  return {
    company: out.company ?? "",
    role: out.role ?? "",
    location: out.location ?? "",
    jdText: out.jdText ?? "",
    applyUrl: out.applyUrl ?? "",
    source: out.source ?? "portal",
  };
}

// Last-resort OCR fallback. Slow (downloads ~30MB language data on first run,
// CPU-bound recognition) — only used when the vision model doesn't accept images.
async function extractViaTesseract(buf: Buffer): Promise<ExtractedJob> {
  const { recognize } = await import("tesseract.js");
  const {
    data: { text },
  } = await recognize(buf, "eng");
  if (!text || text.trim().length < 50) {
    throw new Error("OCR didn't find readable text in that image. Try a clearer screenshot.");
  }
  return extractFromText(text);
}

// Heuristic: did the LLM reject the image because it doesn't support vision?
function looksLikeVisionUnsupported(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("image") &&
    (msg.includes("not support") ||
      msg.includes("invalid") ||
      msg.includes("unsupported") ||
      msg.includes("content type") ||
      msg.includes("image_url"))
  );
}

export async function extractFromImage(buf: Buffer, mimeType = "image/png"): Promise<ExtractedJob> {
  try {
    return await extractViaDeepSeekVision(buf, mimeType);
  } catch (e) {
    if (looksLikeVisionUnsupported(e)) {
      // Vision unavailable on this model — fall back to OCR + text extraction.
      return await extractViaTesseract(buf);
    }
    throw e;
  }
}
