import { NextResponse } from "next/server";

import { resolveJobDeskAiConfig } from "../../../src/ai/config";
import { JobDeskAiError } from "../../../src/ai/errors";
import { generateMainResumeWithAi } from "../../../src/ai/main-resume";
import { skillRegistry } from "../../../src/ai/skills-registry";
import { getResumeTailoringContext } from "../../../src/server/profile-evidence-repository";
import {
  getRecentMainResumes,
  persistMainResume,
  persistTailoredResumeFailure,
  runFactGuardForMainResume,
} from "../../../src/server/resume-repository";
import {
  TailoredResumeGuardrailError,
  validateTailoredResumeDraft,
} from "../../../src/server/tailored-resume-guardrails";

export async function GET() {
  try {
    const resumes = await getRecentMainResumes();
    return NextResponse.json({ data: { resumes } });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load main resumes.",
        kind: "database_error",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  const config = resolveJobDeskAiConfig();
  try {
    const context = await getResumeTailoringContext(null);
    if (!context.profile) {
      return NextResponse.json(
        { error: "Extract a profile before generating a main resume.", kind: "missing_profile" },
        { status: 409 },
      );
    }
    if (context.evidenceItems.length === 0) {
      return NextResponse.json(
        {
          error:
            "Approve at least one evidence item and allow it for resume use before generating a main resume.",
          kind: "missing_approved_evidence",
        },
        { status: 409 },
      );
    }

    const result = await generateMainResumeWithAi({
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
    const persistence = await persistMainResume({
      draft: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      skill: result.skill,
    });
    const factGuard =
      persistence.status === "saved"
        ? await runFactGuardForMainResume(persistence.mainResumeVersionId)
        : null;

    return NextResponse.json({
      data: result.data,
      meta: {
        usage: result.usage,
        retryCount: result.retryCount,
        skill: result.skill,
        evidenceCount: context.evidenceItems.length,
        persistence,
        factGuard,
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
        skill: skillRegistry.mainResume,
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
        provider: `openrouter-compatible:${config.transport}`,
        model: config.model,
        errorKind: "contract_invalid",
        errorMessage: error.message,
        retryCount: 0,
        skill: skillRegistry.mainResume,
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
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      errorKind: "unknown",
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
      retryCount: 0,
      skill: skillRegistry.mainResume,
    });
    return NextResponse.json(
      { error: "Main resume generation failed.", kind: "provider_error" },
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
