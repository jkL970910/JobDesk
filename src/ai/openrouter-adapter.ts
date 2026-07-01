import { classifyHttpFailure, JobDeskAiError } from "./errors";
import {
  extractOutputText,
  extractUsage,
  parseJsonObject,
  validateStructuredOutput,
} from "./output-parser";
import type {
  FetchLike,
  JobDeskAiConfig,
  JobDeskAiDiagnostics,
  StructuredJsonRequest,
  StructuredJsonResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenRouterResponsesAdapter {
  private readonly config: JobDeskAiConfig;
  private readonly fetchFn: FetchLike;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;

  constructor(options: {
    config: JobDeskAiConfig;
    fetchFn?: FetchLike;
    maxAttempts?: number;
    timeoutMs?: number;
  }) {
    this.config = options.config;
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async callStructuredJson<TSchema extends import("zod").z.ZodTypeAny>(
    request: StructuredJsonRequest<TSchema>,
  ): Promise<StructuredJsonResult<import("zod").z.infer<TSchema>>> {
    if (!this.config.providerEnabled) {
      throw new JobDeskAiError("JobDesk AI provider is disabled.", {
        kind: "provider_disabled",
      });
    }
    if (!this.config.apiKey) {
      throw new JobDeskAiError("JOBDESK_OPENROUTER_API_KEY is not configured.", {
        kind: "missing_api_key",
      });
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.callOnce(request);
        return { ...result, retryCount: attempt - 1, skill: request.skill };
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts) {
          if (error instanceof JobDeskAiError) {
            throw new JobDeskAiError(error.message, {
              kind: error.kind,
              status: error.status,
              endpoint: error.endpoint,
              retryCount: attempt - 1,
              diagnostics: {
                ...error.diagnostics,
                finalAttempt: attempt,
                retryCount: attempt - 1,
              },
              cause: error.cause,
            });
          }
          throw new JobDeskAiError("OpenRouter request failed.", {
          kind: "provider_error",
          endpoint: this.config.endpoint,
          retryCount: attempt - 1,
          diagnostics: buildBaseDiagnostics({
            config: this.config,
            failurePhase: "provider_error",
            request,
            retryCount: attempt - 1,
          }),
          cause: error,
        });
      }
      }
    }

    throw new JobDeskAiError("OpenRouter request failed.", {
      kind: "provider_error",
      endpoint: this.config.endpoint,
      retryCount: 1,
      diagnostics: buildBaseDiagnostics({
        config: this.config,
        failurePhase: "provider_error",
        request,
        retryCount: 1,
      }),
      cause: lastError,
    });
  }

  private async callOnce<TSchema extends import("zod").z.ZodTypeAny>(
    request: StructuredJsonRequest<TSchema>,
  ): Promise<StructuredJsonResult<import("zod").z.infer<TSchema>>> {
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? this.timeoutMs;
    const startedAt = Date.now();
    const requestBody = JSON.stringify(this.buildRequestBody(request));
    const baseDiagnostics = buildBaseDiagnostics({
      config: this.config,
      request,
      requestBodyChars: requestBody.length,
      timeoutMs,
    });
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs,
    );
    let response: Response;
    try {
      response = await this.fetchFn(this.config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JobDesk",
        },
        signal: controller.signal,
        body: requestBody,
      });
    } catch (error) {
      const diagnostics = {
        ...baseDiagnostics,
        durationMs: Date.now() - startedAt,
        failurePhase: "fetch" as const,
        receivedResponse: false,
      };
      if (error instanceof Error && error.name === "AbortError") {
        throw new JobDeskAiError("OpenRouter request timed out.", {
          kind: "timeout",
          endpoint: this.config.endpoint,
          diagnostics,
          cause: error,
        });
      }
      if (error instanceof JobDeskAiError) {
        throw new JobDeskAiError(error.message, {
          kind: error.kind,
          status: error.status,
          endpoint: error.endpoint ?? this.config.endpoint,
          retryCount: error.retryCount,
          diagnostics: {
            ...diagnostics,
            ...error.diagnostics,
          },
          cause: error.cause,
        });
      }
      throw new JobDeskAiError("OpenRouter request failed before receiving a response.", {
        kind: "provider_error",
        endpoint: this.config.endpoint,
        diagnostics,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text().catch(() => "");
    const responseDiagnostics = {
      ...baseDiagnostics,
      durationMs: Date.now() - startedAt,
      receivedResponse: true,
      responseChars: responseText.length,
      status: response.status,
    };
    const payload = responseText ? safeJsonParse(responseText) : {};
    if (!response.ok) {
      throw new JobDeskAiError(
        providerErrorMessage(response.status, payload, responseText),
        {
          kind: classifyHttpFailure(response.status),
          status: response.status,
          endpoint: this.config.endpoint,
          diagnostics: {
            ...responseDiagnostics,
            failurePhase: "http",
          },
        },
      );
    }

    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new JobDeskAiError("OpenRouter response did not include output text.", {
        kind: "empty_output",
        endpoint: this.config.endpoint,
        diagnostics: {
          ...responseDiagnostics,
          failurePhase: "empty_output",
        },
      });
    }

    let json: unknown;
    try {
      json = parseJsonObject(outputText);
    } catch (error) {
      if (error instanceof JobDeskAiError) {
        throw new JobDeskAiError(error.message, {
          kind: error.kind,
          endpoint: this.config.endpoint,
          diagnostics: {
            ...responseDiagnostics,
            failurePhase: "invalid_json",
            outputChars: outputText.length,
          },
          cause: error.cause,
        });
      }
      throw error;
    }
    try {
      const data = validateStructuredOutput(request.schema, json);
      return {
        data,
        diagnostics: {
          ...responseDiagnostics,
          outputChars: outputText.length,
        },
        outputText,
        usage: extractUsage(payload),
        retryCount: 0,
        skill: request.skill,
      };
    } catch (error) {
      if (error instanceof JobDeskAiError) {
        throw new JobDeskAiError(error.message, {
          kind: error.kind,
          endpoint: this.config.endpoint,
          diagnostics: {
            ...responseDiagnostics,
            failurePhase: "contract_invalid",
            outputChars: outputText.length,
          },
          cause: error.cause,
        });
      }
      throw error;
    }
  }

  private buildRequestBody<TSchema extends import("zod").z.ZodTypeAny>(
    request: StructuredJsonRequest<TSchema>,
  ) {
    if (this.config.transport === "chat-completions") {
      return {
        model: this.config.model,
        response_format: { type: "json_object" },
        temperature: this.config.temperature,
        ...(this.config.topP != null ? { top_p: this.config.topP } : {}),
        ...(this.config.seed != null ? { seed: this.config.seed } : {}),
        messages: [
          {
            role: "system",
            content: request.instructions,
          },
          {
            role: "user",
            content: request.input,
          },
        ],
        max_tokens: request.maxOutputTokens ?? 1400,
      };
    }

    return {
      model: this.config.model,
      instructions: request.instructions,
      input: [
        {
          role: "user",
          content: request.input,
        },
      ],
      reasoning: { effort: this.config.reasoningEffort },
      temperature: this.config.temperature,
      ...(this.config.topP != null ? { top_p: this.config.topP } : {}),
      ...(this.config.seed != null ? { seed: this.config.seed } : {}),
      text: { verbosity: "low", format: { type: "json_object" } },
      max_output_tokens: request.maxOutputTokens ?? 1400,
      store: this.config.store,
    };
  }
}

function buildBaseDiagnostics<TSchema extends import("zod").z.ZodTypeAny>(args: {
  config: JobDeskAiConfig;
  failurePhase?: JobDeskAiDiagnostics["failurePhase"];
  request: StructuredJsonRequest<TSchema>;
  requestBodyChars?: number;
  retryCount?: number;
  timeoutMs?: number;
}): JobDeskAiDiagnostics {
  return {
    endpoint: args.config.endpoint,
    failurePhase: args.failurePhase,
    inputChars: args.request.input.length,
    instructionsChars: args.request.instructions.length,
    maxOutputTokens: args.request.maxOutputTokens,
    model: args.config.model,
    reasoningEffort: args.config.reasoningEffort,
    requestBodyChars: args.requestBodyChars,
    retryCount: args.retryCount,
    seed: args.config.seed,
    temperature: args.config.temperature,
    topP: args.config.topP,
    task: args.request.task,
    timeoutMs: args.timeoutMs,
    transport: args.config.transport,
  };
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function providerErrorMessage(
  status: number,
  payload: Record<string, unknown>,
  responseText: string,
) {
  const error = payload.error;
  const detail = extractProviderErrorDetail(error, responseText);
  return `OpenRouter request failed with status ${status}: ${detail}`;
}

function extractProviderErrorDetail(error: unknown, responseText: string) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message).slice(0, 220);
  }
  const trimmed = responseText.trim();
  if (!trimmed) return "No provider error body.";
  if (/<(?:!doctype|html|head|body|title|meta)\b/i.test(trimmed)) {
    return "The provider returned an HTML error page.";
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 220);
}
