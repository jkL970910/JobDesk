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

const requestSchema = z.object({
  sourceText: z.string().trim().min(80).max(50_000),
  sourceTitle: z.string().trim().min(1).max(240).optional(),
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
    const persistence = await persistProfileEvidenceExtraction({
      sourceText: parsed.data.sourceText,
      sourceTitle: parsed.data.sourceTitle,
      sourceType: "project-note",
      extraction: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      skill: result.skill,
    });
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

async function persistFailureRun(
  args: Parameters<typeof persistProfileEvidenceFailure>[0],
) {
  try {
    await persistProfileEvidenceFailure(args);
  } catch {
    // Persistence must not hide provider/schema failures from the caller.
  }
}
