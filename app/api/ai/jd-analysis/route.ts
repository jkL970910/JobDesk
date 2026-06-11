import { NextResponse } from "next/server";
import { z } from "zod";

import { JobDeskAiError } from "../../../../src/ai/errors";
import { analyzeJobDescriptionWithAi } from "../../../../src/ai/jd-analysis";
import { resolveJobDeskAiConfig } from "../../../../src/ai/config";
import {
  assertActiveJdAnalysis,
  JobRepositoryError,
  persistJdAnalysis,
  persistJdAnalysisFailure,
} from "../../../../src/server/job-repository";

const requestSchema = z.object({
  jobId: z.string().trim().min(1).max(120).default("jd-ui"),
  targetJobId: z.string().uuid().optional(),
  jdText: z.string().trim().min(20).max(30_000),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid JD analysis request.",
        kind: "invalid_request",
      },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.targetJobId) {
      await assertActiveJdAnalysis(parsed.data.targetJobId);
    }
    const result = await analyzeJobDescriptionWithAi({
      jobId: parsed.data.jobId,
      jdText: parsed.data.jdText,
    });
    const config = resolveJobDeskAiConfig();
    const persistence = await persistJdAnalysis({
      analysis: result.data,
      targetJobId: parsed.data.targetJobId,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
    });
    return NextResponse.json({
      data: result.data,
      meta: {
        usage: result.usage,
        retryCount: result.retryCount,
        persistence,
      },
    });
  } catch (error) {
    const config = resolveJobDeskAiConfig();
    if (error instanceof JobRepositoryError) {
      return NextResponse.json(
        {
          error: error.message,
          kind: error.kind,
        },
        { status: 404 },
      );
    }
    if (error instanceof JobDeskAiError) {
      await persistFailureRun({
        provider: `openrouter-compatible:${config.transport}`,
        model: config.model,
        errorKind: error.kind,
        errorMessage: error.message,
        retryCount: error.retryCount,
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
    });
    return NextResponse.json(
      {
        error: "JD analysis failed.",
        kind: "provider_error",
      },
      { status: 502 },
    );
  }
}

async function persistFailureRun(args: Parameters<typeof persistJdAnalysisFailure>[0]) {
  try {
    await persistJdAnalysisFailure(args);
  } catch {
    // Persistence must not hide the provider/schema failure from the API caller.
  }
}
