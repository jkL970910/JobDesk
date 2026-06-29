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

export type JobDeskAiDiagnostics = {
  task?: string;
  endpoint?: string;
  transport?: JobDeskAiConfig["transport"];
  model?: string;
  reasoningEffort?: JobDeskReasoningEffort;
  inputChars?: number;
  instructionsChars?: number;
  requestBodyChars?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  durationMs?: number;
  responseChars?: number;
  outputChars?: number;
  receivedResponse?: boolean;
  status?: number | null;
  retryCount?: number;
  finalAttempt?: number;
  failurePhase?:
    | "fetch"
    | "http"
    | "empty_output"
    | "invalid_json"
    | "contract_invalid"
    | "provider_error";
};

export type JobDeskAiSkillBinding = {
  skillId: string;
  skillVersion: string;
  promptVersion: string;
  workflowType: string;
  schemaName: string;
  schemaVersion: string;
  modelTier: "none" | "cheap" | "strong";
  sourceSkillIds: readonly string[];
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
  skill: JobDeskAiSkillBinding;
  instructions: string;
  input: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export type StructuredJsonResult<T> = {
  data: T;
  diagnostics?: JobDeskAiDiagnostics;
  outputText: string;
  usage: JobDeskAiUsage;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
};
