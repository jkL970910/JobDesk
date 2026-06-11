import type { z } from "zod";

import { JobDeskAiError } from "./errors";
import type { JobDeskAiUsage } from "./types";

export function extractOutputText(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const text = extractOutputText(item);
      if (text) return text;
    }
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  for (const key of ["output_text", "text", "content"]) {
    const text = extractOutputText(record[key]);
    if (text) return text;
  }
  for (const key of ["output", "choices"]) {
    const text = extractOutputText(record[key]);
    if (text) return text;
  }
  const messageText = extractOutputText(record.message);
  if (messageText) return messageText;
  const deltaText = extractOutputText(record.delta);
  if (deltaText) return deltaText;

  return null;
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = (fenced?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new JobDeskAiError("Provider output was not valid JSON.", {
      kind: "invalid_json",
    });
  }
}

export function validateStructuredOutput<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issueSummary = parsed.error.issues
      .slice(0, 6)
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new JobDeskAiError(
      `Provider output did not match the expected schema.${issueSummary ? ` Issues: ${issueSummary}` : ""}`,
      {
        kind: "contract_invalid",
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}

export function extractUsage(payload: unknown): JobDeskAiUsage {
  if (!payload || typeof payload !== "object") return {};
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return {};
  const record = usage as Record<string, unknown>;
  return {
    inputTokens:
      typeof record.input_tokens === "number"
        ? record.input_tokens
        : typeof record.prompt_tokens === "number"
          ? record.prompt_tokens
          : null,
    outputTokens:
      typeof record.output_tokens === "number"
        ? record.output_tokens
        : typeof record.completion_tokens === "number"
          ? record.completion_tokens
          : null,
    totalTokens:
      typeof record.total_tokens === "number" ? record.total_tokens : null,
  };
}

