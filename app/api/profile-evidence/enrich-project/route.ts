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
import { schedulePersonalEmbeddingsSync } from "../../../../src/server/embedding-service";

const requestSchema = z.object({
  sourceText: z.string().trim().min(80).max(50_000),
  sourceTitle: z.string().trim().min(1).max(240).optional(),
  sourceDocumentId: z.string().uuid().optional(),
  target: z
    .object({
      missingFields: z.array(z.string().trim().min(1).max(80)).default([]),
      targetId: z.string().uuid(),
      targetTitle: z.string().trim().min(1).max(240).optional(),
      targetType: z.enum(["initiative", "portfolio_project", "legacy_project"]),
    })
    .optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project enrichment request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const config = resolveJobDeskAiConfig();
  try {
    const result = await extractProfileEvidenceWithAi({
      sourceId: "project-library-ui",
      sourceText: parsed.data.sourceText,
      sourceKind: "project_note",
    });
    let persistence;
    let sourceDocumentRecovered = false;
    const persistenceArgs = {
      sourceText: parsed.data.sourceText,
      sourceTitle: parsed.data.sourceTitle,
      sourceDocumentId: parsed.data.sourceDocumentId,
      sourceType: "project-note" as const,
      target: parsed.data.target,
      extraction: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      skill: result.skill,
    };
    try {
      persistence = await persistProfileEvidenceExtraction(persistenceArgs);
    } catch (persistenceError) {
      if (
        parsed.data.sourceDocumentId &&
        isRecoverableSourceDocumentError(persistenceError)
      ) {
        try {
          persistence = await persistProfileEvidenceExtraction({
            ...persistenceArgs,
            sourceDocumentId: undefined,
          });
          sourceDocumentRecovered = true;
        } catch (fallbackPersistenceError) {
          return NextResponse.json(
            {
              error: persistenceErrorMessage(fallbackPersistenceError),
              kind: "source_document_mismatch",
            },
            { status: 409 },
          );
        }
      } else {
        return NextResponse.json(
          {
            error: persistenceErrorMessage(persistenceError),
            kind: "source_document_mismatch",
          },
          { status: 409 },
        );
      }
    }
    const persistenceMeta =
      sourceDocumentRecovered && persistence.status === "saved"
        ? { ...persistence, sourceDocumentRecovered }
        : persistence;
    if (persistence.status === "saved") {
      schedulePersonalEmbeddingsSync("profile_evidence_enrich_project");
    }
    return NextResponse.json({
      data: result.data,
      meta: {
        usage: result.usage,
        retryCount: result.retryCount,
        skill: result.skill,
        persistence: persistenceMeta,
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
        skill: skillRegistry.profileEvidenceExtractionProjectNote,
      });
      return NextResponse.json(
        {
          error: error.message,
          kind: error.kind,
          status: error.status,
          retryCount: error.retryCount,
        },
        { status: error.kind === "missing_api_key" ? 503 : 502 },
      );
    }

    await persistFailureRun({
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      errorKind: "unknown",
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionProjectNote,
    });
    return NextResponse.json(
      { error: "Project evidence enrichment failed.", kind: "provider_error" },
      { status: 502 },
    );
  }
}

function isRecoverableSourceDocumentError(error: unknown) {
  const message = persistenceErrorMessage(error);
  return (
    message === "Source document text does not match the parsed source." ||
    message === "Source document not found for this workspace."
  );
}

function persistenceErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not persist project evidence.";
}

async function persistFailureRun(
  args: Parameters<typeof persistProfileEvidenceFailure>[0],
) {
  try {
    await persistProfileEvidenceFailure(args);
  } catch {
    // Persistence must not hide provider/schema failures from the caller.
  }
}
