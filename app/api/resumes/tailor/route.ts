import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveJobDeskAiConfig } from "../../../../src/ai/config";
import { JobDeskAiError } from "../../../../src/ai/errors";
import { skillRegistry } from "../../../../src/ai/skills-registry";
import { generateTailoredResumeWithAi } from "../../../../src/ai/tailored-resume";
import { getJdAnalysisById } from "../../../../src/server/job-repository";
import { getResumeTailoringContext } from "../../../../src/server/profile-evidence-repository";
import {
  persistTailoredResume,
  persistTailoredResumeFailure,
  runFactGuardForResume,
} from "../../../../src/server/resume-repository";
import {
  TailoredResumeGuardrailError,
  validateTailoredResumeDraft,
} from "../../../../src/server/tailored-resume-guardrails";

const requestSchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid tailored resume request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const config = resolveJobDeskAiConfig();
  try {
    const job = await getJdAnalysisById(parsed.data.jobId);
    if (!job) {
      return NextResponse.json(
        { error: "Job not found or archived.", kind: "job_not_found" },
        { status: 404 },
      );
    }

    const context = await getResumeTailoringContext(job);
    if (!context.profile) {
      return NextResponse.json(
        { error: "Extract a profile before tailoring a resume.", kind: "missing_profile" },
        { status: 409 },
      );
    }
    if (context.evidenceItems.length === 0) {
      return NextResponse.json(
        {
          error:
            "Approve at least one evidence item and allow it for resume use before tailoring.",
          kind: "missing_approved_evidence",
        },
        { status: 409 },
      );
    }

    const result = await generateTailoredResumeWithAi({
      job,
      profile: context.profile.profile,
      evidenceItems: context.evidenceItems,
    });
    validateTailoredResumeDraft({
      draft: result.data,
      eligibleEvidence: context.evidenceItems.map((item) => ({
        id: item.id,
        source_quote: item.source_quote,
        text: item.text,
        public_safe_summary: item.public_safe_summary,
      })),
    });
    const persistence = await persistTailoredResume({
      jobId: parsed.data.jobId,
      draft: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      skill: result.skill,
    });
    const factGuard =
      persistence.status === "saved"
        ? await runFactGuardForResume(persistence.resumeVersionId).catch((caught) => ({
            status: "failed" as const,
            reason:
              caught instanceof Error
                ? caught.message
                : "Tailored resume claim review failed.",
          }))
        : null;

    return NextResponse.json({
      data: result.data,
      meta: {
        usage: result.usage,
        retryCount: result.retryCount,
        skill: result.skill,
        evidenceCount: context.evidenceItems.length,
        selectedEvidence: context.evidenceItems.map((item) => ({
          id: item.id,
          retrieval_score: item.retrieval_score,
          reason_for_selection: item.reason_for_selection,
        })),
        persistence,
        factGuard,
      },
    });
  } catch (error) {
    if (error instanceof JobDeskAiError) {
      await persistFailureRun({
        jobId: parsed.data.jobId,
        provider: `openrouter-compatible:${config.transport}`,
        model: config.model,
        errorKind: error.kind,
        errorMessage: error.message,
        retryCount: error.retryCount,
        skill: skillRegistry.tailoredResume,
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

    if (error instanceof TailoredResumeGuardrailError) {
      await persistFailureRun({
        jobId: parsed.data.jobId,
        provider: `openrouter-compatible:${config.transport}`,
        model: config.model,
        errorKind: "contract_invalid",
        errorMessage: error.message,
        retryCount: 0,
        skill: skillRegistry.tailoredResume,
      });
      return NextResponse.json(
        {
          error: error.message,
          kind: error.kind,
        },
        { status: 422 },
      );
    }

    await persistFailureRun({
      jobId: parsed.data.jobId,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      errorKind: "unknown",
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
      retryCount: 0,
      skill: skillRegistry.tailoredResume,
    });
    return NextResponse.json(
      { error: "Tailored resume generation failed.", kind: "provider_error" },
      { status: 502 },
    );
  }
}

async function persistFailureRun(
  args: Parameters<typeof persistTailoredResumeFailure>[0],
) {
  try {
    await persistTailoredResumeFailure(args);
  } catch {
    // Provider/schema failures should remain visible even if audit persistence fails.
  }
}
