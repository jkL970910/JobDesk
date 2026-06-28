import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveJobDeskAiConfig } from "../../../../src/ai/config";
import { JobDeskAiError } from "../../../../src/ai/errors";
import { extractProfileEvidenceWithAi } from "../../../../src/ai/profile-evidence-extraction";
import { skillRegistry } from "../../../../src/ai/skills-registry";
import {
  persistProfileEvidenceExtraction,
  persistProfileEvidenceFailure,
} from "../../../../src/server/profile-evidence-repository";
import { markResumeSourceExtracted } from "../../../../src/server/resume-review-repository";
import { schedulePersonalEmbeddingsSync } from "../../../../src/server/embedding-service";

const requestSchema = z.object({
  sourceText: z.string().trim().min(80).max(50_000),
  sourceTitle: z.string().trim().min(1).max(240).optional(),
  sourceDocumentId: z.string().uuid().optional(),
  sourceType: z.enum(["profile-evidence", "jd-gap-note"]).optional(),
  resumeSourceVersionId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid profile evidence extraction request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const config = resolveJobDeskAiConfig();
  try {
    const result = await extractProfileEvidenceWithAi({
      sourceId: "profile-evidence-ui",
      sourceText: parsed.data.sourceText,
    });
    let persistence;
    try {
      persistence = await persistProfileEvidenceExtraction({
        sourceText: parsed.data.sourceText,
        sourceTitle: parsed.data.sourceTitle,
        sourceDocumentId: parsed.data.sourceDocumentId,
        sourceType: parsed.data.sourceType,
        extraction: result.data,
        provider: `openrouter-compatible:${config.transport}`,
        model: config.model,
        usage: result.usage,
        retryCount: result.retryCount,
        skill: result.skill,
      });
    } catch (persistenceError) {
      return NextResponse.json(
        {
          error:
            persistenceError instanceof Error
              ? persistenceError.message
              : "Could not persist extracted evidence.",
          kind: "source_document_mismatch",
        },
        { status: 409 },
      );
    }
    if (persistence.status === "saved" && parsed.data.resumeSourceVersionId) {
      await markResumeSourceExtracted(parsed.data.resumeSourceVersionId);
    }
    if (persistence.status === "saved") {
      schedulePersonalEmbeddingsSync("profile_evidence_extract");
    }
    return NextResponse.json({
      data: result.data,
      meta: {
        usage: result.usage,
        retryCount: result.retryCount,
        skill: result.skill,
        persistence,
      },
    });
  } catch (error) {
    if (error instanceof JobDeskAiError) {
      await persistFailureRun({
        provider: `openrouter-compatible:${config.transport}`,
        model: config.model,
        errorKind: error.kind,
        errorMessage: error.message,
        retryCount: error.retryCount,
        skill: skillRegistry.profileEvidenceExtractionResume,
      });
      return NextResponse.json(
        providerFailurePayload(error, "AI extraction timed out. Your source was saved; retry or split the material."),
        { status: error.kind === "missing_api_key" ? 503 : 502 },
      );
    }

    await persistFailureRun({
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      errorKind: "unknown",
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    return NextResponse.json(
      { error: "Profile evidence extraction failed.", kind: "provider_error" },
      { status: 502 },
    );
  }
}

function providerFailurePayload(error: JobDeskAiError, timeoutMessage: string) {
  const providerTimedOut = error.status === 524 || error.kind === "timeout";
  return {
    error: providerTimedOut ? timeoutMessage : error.message,
    kind: providerTimedOut ? "provider_timeout" : error.kind,
    status: error.status,
    retryCount: error.retryCount,
    canRetry: providerTimedOut || error.kind === "provider_5xx" || error.kind === "rate_limit",
    retryAfterSeconds: providerTimedOut ? 10 : undefined,
  };
}

async function persistFailureRun(
  args: Parameters<typeof persistProfileEvidenceFailure>[0],
) {
  try {
    await persistProfileEvidenceFailure(args);
  } catch {
    // Persistence must not hide the provider/schema failure from the API caller.
  }
}
