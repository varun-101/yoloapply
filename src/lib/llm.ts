import OpenAI from "openai";

// Per-user DeepSeek keys: clients are cached per key (on globalThis so the
// cache survives HMR, same pattern as db.ts).
const globalForLlm = globalThis as unknown as { __llmClients?: Map<string, OpenAI> };
const clients = (globalForLlm.__llmClients ??= new Map<string, OpenAI>());

export function llm(apiKey: string): OpenAI {
  const cached = clients.get(apiKey);
  if (cached) return cached;
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });
  clients.set(apiKey, client);
  return client;
}

// Server-level key — used ONLY for global discovery work (HN extraction)
// that runs outside any user context. Everything user-facing passes the
// user's own key from src/lib/credentials.ts.
export function serverApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY (server-level) is not set.");
  return key;
}

export const LLM_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

// Strip the most obvious "written by an LLM" punctuation tell — em/en dashes —
// and tidy the spacing left behind. Em dashes become a comma; spaced en dashes
// used as separators become commas (numeric ranges like 2024–2026 are left alone).
// Used on any free-text the model generates that a human will read/paste.
export function deAi(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s+—\s+/g, ", ")
    .replace(/—/g, ", ")
    .replace(/\s+–\s+/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseJsonFromText<T = unknown>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found in model output:\n" + text.slice(0, 400));
  }
  return JSON.parse(t.slice(start, end + 1)) as T;
}

export interface ChatJsonOptions {
  apiKey: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

// Calls DeepSeek with JSON output mode and returns the parsed object.
//
// DeepSeek's reasoning models (deepseek-v4-pro / deepseek-reasoner) spend a chunk
// of the budget in a separate `reasoning_content` channel. Two failure modes show
// up: (1) the visible `content` comes back empty even with finish_reason=stop, and
// (2) the model occasionally emits the JSON into `reasoning_content` instead of
// `content`. We handle both: try content, then salvage from reasoning_content,
// then retry a couple of times before giving up. We also give the reasoner extra
// headroom by default so it doesn't truncate mid-answer.
export async function chatJson<T = unknown>(opts: ChatJsonOptions): Promise<T> {
  const maxTokens = opts.maxTokens ?? 8192;
  const attempts = 3;
  let lastInfo = "";

  for (let i = 0; i < attempts; i++) {
    const resp = await llm(opts.apiKey).chat.completions.create({
      model: LLM_MODEL,
      max_tokens: maxTokens,
      temperature: opts.temperature ?? 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    });

    const msg = resp.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    const content = msg?.content ?? "";

    if (content) {
      return parseJsonFromText<T>(content);
    }

    // Salvage: the reasoner sometimes leaves `content` empty and puts the JSON
    // (or a usable JSON fragment) in `reasoning_content`.
    const reasoning = msg?.reasoning_content ?? "";
    if (reasoning && reasoning.includes("{") && reasoning.includes("}")) {
      try {
        return parseJsonFromText<T>(reasoning);
      } catch {
        // fall through to retry
      }
    }

    const finish = resp.choices[0]?.finish_reason ?? "unknown";
    const used = resp.usage?.completion_tokens ?? "?";
    lastInfo = `finish_reason=${finish}, completion_tokens=${used}, attempt ${i + 1}/${attempts}`;
  }

  throw new Error(
    `LLM returned empty content after ${attempts} attempts (${lastInfo}). ` +
      "This is a DeepSeek reasoning-model quirk; retrying usually clears it."
  );
}
