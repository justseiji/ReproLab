import { liveAiStatus, type AppConfig } from "@reprolab/shared/node";
import type { AiProviderId } from "@reprolab/shared";
import type { ModelProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { OllamaProvider } from "./providers/ollama";
import { OpenAiProvider } from "./providers/openai";

/**
 * Provider registry. To add a provider: add its metadata to
 * packages/shared/src/ai-providers.ts, implement ModelProvider in
 * ./providers/<name>.ts, and add one line here. Nothing else changes: the
 * planner, validation, evidence and evaluation only see ModelProvider.
 */
type Factory = (ai: AppConfig["ai"]) => ModelProvider;

const common = (ai: AppConfig["ai"]) => ({
  model: ai.model,
  baseUrl: ai.baseUrl,
  maxOutputTokens: ai.maxOutputTokens,
  timeoutMs: ai.requestTimeoutMs,
});

const FACTORIES: Record<AiProviderId, Factory> = {
  anthropic: (ai) =>
    new AnthropicProvider({ ...common(ai), apiKey: ai.apiKey!, effort: ai.effort, refusalFallback: ai.refusalFallback }),
  openai: (ai) => new OpenAiProvider({ ...common(ai), apiKey: ai.apiKey! }),
  gemini: (ai) => new GeminiProvider({ ...common(ai), apiKey: ai.apiKey! }),
  ollama: (ai) => new OllamaProvider(common(ai)),
};

/** Returns the configured provider, or null when live AI is not available (e.g. missing key). */
export function createModelProvider(config: AppConfig): ModelProvider | null {
  if (!liveAiStatus(config).available) return null;
  return FACTORIES[config.ai.provider](config.ai);
}
