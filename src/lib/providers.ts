// Supported LLM providers — all use the OpenAI-compatible chat/completions API.
// Safe to import from client components (no Node.js-specific dependencies).

export interface ProviderConfig {
  label: string;
  baseURL: string;
  defaultModel: string;
  keyHint: string;
  docsUrl: string;
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    keyHint: "sk-…",
    docsUrl: "https://platform.deepseek.com/api-keys",
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.5-flash",
    keyHint: "sk-or-…",
    docsUrl: "https://openrouter.ai/keys",
  },
  gemini: {
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.0-flash",
    keyHint: "AIza…",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    keyHint: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
  },
};

export const DEFAULT_PROVIDER = "deepseek";

export function getProviderConfig(provider: string | null | undefined): ProviderConfig {
  return PROVIDER_CONFIGS[provider ?? DEFAULT_PROVIDER] ?? PROVIDER_CONFIGS[DEFAULT_PROVIDER];
}
