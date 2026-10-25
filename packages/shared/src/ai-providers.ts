/**
 * The model providers live AI mode can use. This is metadata only (safe for
 * the browser); the adapters themselves live in apps/worker/src/ai/providers.
 *
 * Adding a provider: add an entry here, write one adapter that implements
 * ModelProvider, and register it in apps/worker/src/ai/registry.ts.
 */
export const AI_PROVIDER_IDS = ["anthropic", "openai", "gemini", "ollama"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProviderInfo {
  label: string;
  /** Used when AI_MODEL is not set. Override it for cost or availability. */
  defaultModel: string;
  /** Environment variable holding the API key, or null for keyless local providers. */
  apiKeyEnv: string | null;
  /** Environment variable that overrides the API base URL. */
  baseUrlEnv: string;
  defaultBaseUrl: string;
  local: boolean;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  anthropic: {
    label: "Anthropic Claude",
    defaultModel: "claude-opus-5-5",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com",
    local: false,
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-6-astra",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    local: false,
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-3.6-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrlEnv: "GEMINI_BASE_URL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    local: false,
  },
  ollama: {
    label: "Ollama (local)",
    defaultModel: "gpt-oss",
    apiKeyEnv: null,
    baseUrlEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:11434",
    local: true,
  },
};
