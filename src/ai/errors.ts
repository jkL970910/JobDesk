import type { JobDeskAiFailureKind } from "./types";

export class JobDeskAiError extends Error {
  readonly kind: JobDeskAiFailureKind;
  readonly status: number | null;
  readonly endpoint: string | null;
  readonly retryCount: number;

  constructor(
    message: string,
    options: {
      kind: JobDeskAiFailureKind;
      status?: number | null;
      endpoint?: string | null;
      retryCount?: number;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "JobDeskAiError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.endpoint = options.endpoint ?? null;
    this.retryCount = options.retryCount ?? 0;
    this.cause = options.cause;
  }
}

export function classifyHttpFailure(status: number): JobDeskAiFailureKind {
  if (status === 429) return "rate_limit";
  if (status >= 500) return "provider_5xx";
  if (status >= 400) return "provider_4xx";
  return "provider_error";
}

