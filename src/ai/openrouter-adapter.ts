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
  StructuredJsonRequest,
  StructuredJsonResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenRouterResponsesAdapter {
  private readonly config: JobDeskAiConfig;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: {
    config: JobDeskAiConfig;
    fetchFn?: FetchLike;
    timeoutMs?: number;
  }) {
    this.config = options.config;
    this.fetchFn = options.fetchFn ?? fetch;
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
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await this.callOnce(request);
        return { ...result, retryCount: attempt - 1 };
      } catch (error) {
        lastError = error;
        if (attempt === 2) {
          if (error instanceof JobDeskAiError) {
            throw new JobDeskAiError(error.message, {
              kind: error.kind,
              status: error.status,
              endpoint: error.endpoint,
              retryCount: attempt - 1,
              cause: error.cause,
            });
          }
          throw new JobDeskAiError("OpenRouter request failed.", {
            kind: "provider_error",
            endpoint: this.config.endpoint,
            retryCount: attempt - 1,
            cause: error,
          });
        }
      }
    }

    throw new JobDeskAiError("OpenRouter request failed.", {
      kind: "provider_error",
      endpoint: this.config.endpoint,
      retryCount: 1,
      cause: lastError,
    });
  }

  private async callOnce<TSchema extends import("zod").z.ZodTypeAny>(
    request: StructuredJsonRequest<TSchema>,
  ): Promise<StructuredJsonResult<import("zod").z.infer<TSchema>>> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      request.timeoutMs ?? this.timeoutMs,
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
        body: JSON.stringify(this.buildRequestBody(request)),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new JobDeskAiError("OpenRouter request timed out.", {
          kind: "timeout",
          endpoint: this.config.endpoint,
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await response.text().catch(() => "");
    const payload = responseText ? safeJsonParse(responseText) : {};
    if (!response.ok) {
      throw new JobDeskAiError(
        providerErrorMessage(response.status, payload, responseText),
        {
          kind: classifyHttpFailure(response.status),
          status: response.status,
          endpoint: this.config.endpoint,
        },
      );
    }

    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new JobDeskAiError("OpenRouter response did not include output text.", {
        kind: "empty_output",
        endpoint: this.config.endpoint,
      });
    }

    const json = parseJsonObject(outputText);
    return {
      data: validateStructuredOutput(request.schema, json),
      outputText,
      usage: extractUsage(payload),
      retryCount: 0,
    };
  }

  private buildRequestBody<TSchema extends import("zod").z.ZodTypeAny>(
    request: StructuredJsonRequest<TSchema>,
  ) {
    if (this.config.transport === "chat-completions") {
      return {
        model: this.config.model,
        response_format: { type: "json_object" },
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
      text: { verbosity: "low", format: { type: "json_object" } },
      max_output_tokens: request.maxOutputTokens ?? 1400,
      store: this.config.store,
    };
  }
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
  const detail =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : responseText.trim()
        ? responseText.trim().slice(0, 500)
        : "No provider error body.";
  return `OpenRouter request failed with status ${status}: ${detail}`;
}
