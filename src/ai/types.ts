import type { z } from "zod";

export type JobDeskAiFailureKind =
  | "missing_api_key"
  | "provider_disabled"
  | "provider_4xx"
  | "provider_5xx"
  | "rate_limit"
  | "timeout"
  | "empty_output"
  | "invalid_json"
  | "contract_invalid"
  | "provider_error";

export type JobDeskReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type JobDeskAiUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export type JobDeskAiConfig = {
  providerEnabled: boolean;
  apiKey: string | null;
  endpoint: string;
  transport: "responses" | "chat-completions";
  model: string;
  reasoningEffort: JobDeskReasoningEffort;
  store: boolean;
};

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type StructuredJsonRequest<TSchema extends z.ZodTypeAny> = {
  schema: TSchema;
  task: string;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export type StructuredJsonResult<T> = {
  data: T;
  outputText: string;
  usage: JobDeskAiUsage;
  retryCount: number;
};
