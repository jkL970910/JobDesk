import type { JobDeskAiConfig, JobDeskReasoningEffort } from "./types";

const DEFAULT_OPENROUTER_ENDPOINT = "https://openrouter.icu/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_REASONING_EFFORT = "medium";
const DEFAULT_TEMPERATURE = 0;

const reasoningEfforts = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export function normalizeOpenRouterResponsesEndpoint(value?: string | null) {
  const raw = (value?.trim() || DEFAULT_OPENROUTER_ENDPOINT).replace(/\/+$/, "");
  if (raw.endsWith("/responses")) return raw;
  if (raw.endsWith("/api/v1")) return `${raw}/responses`;
  if (raw.endsWith("/v1")) return `${raw}/responses`;

  const host = (() => {
    try {
      return new URL(raw).hostname;
    } catch {
      return "";
    }
  })();

  return host === "openrouter.ai" ? `${raw}/api/v1/responses` : `${raw}/v1/responses`;
}

export function normalizeOpenRouterChatCompletionsEndpoint(value?: string | null) {
  const raw = (value?.trim() || DEFAULT_OPENROUTER_ENDPOINT).replace(/\/+$/, "");
  if (raw.endsWith("/chat/completions")) return raw;
  if (raw.endsWith("/responses")) return raw.replace(/\/responses$/, "/chat/completions");
  if (raw.endsWith("/api/v1")) return `${raw}/chat/completions`;
  if (raw.endsWith("/v1")) return `${raw}/chat/completions`;

  const host = (() => {
    try {
      return new URL(raw).hostname;
    } catch {
      return "";
    }
  })();

  return host === "openrouter.ai"
    ? `${raw}/api/v1/chat/completions`
    : `${raw}/v1/chat/completions`;
}

function normalizeReasoningEffort(value?: string | null): JobDeskReasoningEffort {
  const normalized = value?.trim();
  return reasoningEfforts.has(normalized ?? "")
    ? (normalized as JobDeskReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

function normalizeOptionalNumber(value?: string | null) {
  const parsed = value == null || value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTemperature(value?: string | null) {
  const parsed = normalizeOptionalNumber(value);
  if (parsed == null) return DEFAULT_TEMPERATURE;
  return Math.min(2, Math.max(0, parsed));
}

export function resolveJobDeskAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): JobDeskAiConfig {
  const transport =
    env.JOBDESK_OPENROUTER_TRANSPORT === "chat-completions"
    ? "chat-completions"
    : env.JOBDESK_OPENROUTER_TRANSPORT === "responses"
      ? "responses"
      : "chat-completions";
  const rawBaseUrl = env.JOBDESK_OPENROUTER_BASE_URL;
  return {
    providerEnabled: env.JOBDESK_PROVIDER_ENABLED !== "false",
    apiKey: env.JOBDESK_OPENROUTER_API_KEY?.trim() || null,
    transport,
    endpoint:
      transport === "chat-completions"
        ? normalizeOpenRouterChatCompletionsEndpoint(rawBaseUrl)
        : normalizeOpenRouterResponsesEndpoint(rawBaseUrl),
    model: env.JOBDESK_AI_MODEL?.trim() || DEFAULT_MODEL,
    reasoningEffort: normalizeReasoningEffort(env.JOBDESK_AI_REASONING_EFFORT),
    seed: normalizeOptionalNumber(env.JOBDESK_AI_SEED),
    store: env.JOBDESK_DISABLE_RESPONSE_STORAGE === "true" ? false : true,
    temperature: normalizeTemperature(env.JOBDESK_AI_TEMPERATURE),
    topP: normalizeOptionalNumber(env.JOBDESK_AI_TOP_P),
  };
}
