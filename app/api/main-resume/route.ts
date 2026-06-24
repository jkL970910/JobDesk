import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveJobDeskAiConfig } from "../../../src/ai/config";
import { JobDeskAiError } from "../../../src/ai/errors";
import { generateMainResumeWithAi } from "../../../src/ai/main-resume";
import { skillRegistry } from "../../../src/ai/skills-registry";
import {
  getMainResumeRefreshSourceId,
  inferMainResumeGenerationMode,
  MainResumePostRequest,
  MainResumeRequestError,
  validateMainResumeModeSelection,
} from "../../../src/server/main-resume-request";
import { getResumeTailoringContext } from "../../../src/server/profile-evidence-repository";
import { getProfilePositioningReportById } from "../../../src/server/profile-positioning-repository";
import { getResumeSourceVersion } from "../../../src/server/resume-review-repository";
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

export async function POST(request: Request) {
  const config = resolveJobDeskAiConfig();
  try {
    const parsed = MainResumePostRequest.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid main resume generation request.", kind: "invalid_request" },
        { status: 400 },
      );
    }
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

    const generationMode = validateMainResumeModeSelection(
      parsed.data,
      inferMainResumeGenerationMode(parsed.data),
    );
    const positioning = await resolvePositioningSelection(parsed.data, generationMode);
    const refresh = await resolveRefreshSelection(parsed.data, generationMode);

    const result = await generateMainResumeWithAi({
      profile: context.profile.profile,
      evidenceItems: context.evidenceItems,
      positioningDirection: positioning?.direction ?? null,
      refreshContext: refresh
        ? {
            sourceResumeText: refresh.sourceResume.sourceText,
            sourceResumeTitle: refresh.sourceResume.title,
            mode: refresh.mode,
            styleConstraints: refresh.styleConstraints,
          }
        : null,
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
      generationMode,
      positioning,
      refresh,
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
        positioning: positioning
          ? {
              reportId: positioning.reportId,
              directionId: positioning.direction.id,
              targetRole: positioning.direction.target_role,
            }
          : null,
        refresh: refresh
          ? {
              sourceResumeVersionId: refresh.sourceResume.id,
              sourceResumeTitle: refresh.sourceResume.title,
              mode: refresh.mode,
              styleConstraints: refresh.styleConstraints,
            }
          : null,
        selectedEvidence: context.evidenceItems,
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

    if (error instanceof MainResumeSelectionError || error instanceof MainResumeRequestError) {
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
          kind: "invalid_positioning_selection",
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

async function resolvePositioningSelection(
  selection:
    | {
        positioningReportId?: string;
        positioningDirectionId?: string;
      }
    | undefined,
  generationMode: ReturnType<typeof inferMainResumeGenerationMode>,
) {
  if (generationMode === "positioning_variant") {
    if (!selection?.positioningReportId || !selection.positioningDirectionId) {
      throw new MainResumeSelectionError(
        "Select both a positioning report and a direction before generating a variant.",
      );
    }
  }
  if (!selection?.positioningReportId && !selection?.positioningDirectionId) {
    return null;
  }
  if (!selection.positioningReportId || !selection.positioningDirectionId) {
    throw new MainResumeSelectionError(
      "Select both a positioning report and a direction before generating a variant.",
    );
  }
  const report = await getProfilePositioningReportById(selection.positioningReportId);
  if (!report) {
    throw new MainResumeSelectionError(
      "Selected positioning report was not found in this workspace.",
    );
  }
  const direction = report.report.directions.find(
    (candidate) => candidate.id === selection.positioningDirectionId,
  );
  if (!direction) {
    throw new MainResumeSelectionError(
      "Selected positioning direction was not found in this report.",
    );
  }
  return {
    reportId: report.id,
    direction,
  };
}

async function resolveRefreshSelection(
  selection: MainResumePostRequest,
  generationMode: ReturnType<typeof inferMainResumeGenerationMode>,
) {
  if (generationMode !== "resume_refresh") return null;
  const sourceResumeVersionId = getMainResumeRefreshSourceId(selection);
  if (!sourceResumeVersionId) {
    throw new MainResumeSelectionError("Select an old resume before refreshing it.");
  }
  if (!selection?.refreshMode) {
    throw new MainResumeSelectionError("Select a refresh mode before refreshing a resume.");
  }
  const sourceResume = await getResumeSourceVersion(sourceResumeVersionId);
  if (sourceResume.status !== "ready") {
    throw new MainResumeSelectionError(
      sourceResume.status === "not_found"
        ? "Selected resume source was not found in this workspace."
        : "Selected resume source is not available.",
    );
  }
  return {
    sourceResume: sourceResume.resume,
    mode: selection.refreshMode,
    styleConstraints: selection.styleConstraints ?? {},
  };
}

class MainResumeSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MainResumeSelectionError";
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
