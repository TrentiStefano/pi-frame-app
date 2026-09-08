export interface CustomProviderModelInput {
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
  readonly thinkingLevelMap?: Partial<Record<CustomProviderThinkingLevel, string | null>>;
  readonly input?: readonly ("text" | "image")[];
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly cost?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
}

export type CustomProviderThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CustomProviderApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export interface CustomProviderInput {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly api?: CustomProviderApi;
  readonly apiKey?: string;
  readonly models: readonly CustomProviderModelInput[];
}

export interface CustomProviderEntry {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly api: CustomProviderApi;
  readonly apiKey?: string;
  readonly models: readonly CustomProviderModelInput[];
}

export interface CustomProviderModelMutationInput {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly api?: CustomProviderApi;
  readonly apiKey?: string;
  readonly model: CustomProviderModelInput;
}

export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const OPENAI_COMPLETIONS_API = "openai-completions";
export const CUSTOM_PROVIDER_APIS: readonly CustomProviderApi[] = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

export const CUSTOM_PROVIDER_PLACEHOLDER_API_KEY = "unused";
export const PI_GUI_CUSTOM_PROVIDER_MARKER = "piGuiCustomEndpoint";
export const PI_GUI_CONFIGURED_MODEL_MARKER = "piGuiConfiguredModel";
export const BUILT_IN_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "amazon-bedrock",
  "anthropic",
  "azure-openai-responses",
  "cerebras",
  "deepseek",
  "fireworks",
  "github-copilot",
  "google",
  "google-antigravity",
  "google-gemini-cli",
  "google-vertex",
  "groq",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "mistral",
  "openai",
  "openai-codex",
  "opencode",
  "opencode-go",
  "openrouter",
  "vercel-ai-gateway",
  "xai",
  "zai",
]);

export function isValidHttpBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.host.length > 0;
  } catch {
    return false;
  }
}
