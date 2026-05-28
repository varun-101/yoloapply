import OpenAI from "openai";

let _client: OpenAI | null = null;

export function llm(): OpenAI {
  if (_client) return _client;
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Copy .env.example to .env and add your DeepSeek key."
    );
  }
  _client = new OpenAI({
    apiKey: key,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });
  return _client;
}

export const LLM_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

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
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

// Calls DeepSeek with JSON output mode and returns the parsed object.
//
// Note on max_tokens: DeepSeek's `deepseek-chat` now routes to a reasoning model
// (v4-pro) which spends a chunk of the completion budget on internal reasoning
// tokens before producing the visible JSON. We default to 8192 so the visible
// JSON has room after reasoning. Callers can override.
export async function chatJson<T = unknown>(opts: ChatJsonOptions): Promise<T> {
  const resp = await llm().chat.completions.create({
    model: LLM_MODEL,
    max_tokens: opts.maxTokens ?? 8192,
    temperature: opts.temperature ?? 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  const content = resp.choices[0]?.message?.content ?? "";
  if (!content) {
    const finish = resp.choices[0]?.finish_reason ?? "unknown";
    const used = resp.usage?.completion_tokens ?? "?";
    throw new Error(
      `LLM returned empty content (finish_reason=${finish}, completion_tokens=${used}). ` +
        "If this is a DeepSeek reasoning model, try a higher max_tokens."
    );
  }
  return parseJsonFromText<T>(content);
}
