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
    const resp = await llm().chat.completions.create({
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
