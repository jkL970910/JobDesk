import { resolveJobDeskAiConfig } from "../ai/config";
import { JobDeskAiError } from "../ai/errors";
import {
  buildProfileEvidenceExtractionFromStepRunnerState,
  buildSectionRetryPayloadsFromStepRunnerState,
  extractProfileEvidenceChunked,
  getProfileEvidenceStepRunnerProgress,
  initializeProfileEvidenceStepRunnerState,
  parseProfileEvidenceStepRunnerState,
  processNextProfileEvidenceStepRunnerSegment,
  serializeProfileEvidenceStepRunnerState,
} from "../ai/profile-evidence-chunked-extraction";
import { skillRegistry } from "../ai/skills-registry";
import {
  claimProfileEvidenceExtractionRunById,
  claimNextProfileEvidenceExtractionRun,
  completeProfileEvidenceExtractionRun,
  failProfileEvidenceExtractionRun,
  getProfileEvidenceExtractionRunOwner,
  resolveProfileEvidenceExtractionRunSource,
  saveProfileEvidenceExtractionRunProgress,
  type ProfileEvidenceExtractionReplacement,
  updateProfileEvidenceExtractionRunStatus,
} from "./profile-evidence-extraction-run-repository";
import {
  persistProfileEvidenceExtraction,
  persistProfileEvidenceFailure,
} from "./profile-evidence-repository";
import { markResumeSourceExtracted } from "./resume-review-repository";
import { schedulePersonalEmbeddingsSync } from "./embedding-service";
import { runWithAuthContext } from "./auth-service";

type ClaimedExtractionRun = Extract<
  Awaited<ReturnType<typeof claimNextProfileEvidenceExtractionRun>>,
  { status: "claimed" }
>;

export type ProfileEvidenceExtractionWorkerDependencies = {
  claimRunById: typeof claimProfileEvidenceExtractionRunById;
  claimNextRun: typeof claimNextProfileEvidenceExtractionRun;
  completeRun: typeof completeProfileEvidenceExtractionRun;
  failRun: typeof failProfileEvidenceExtractionRun;
  getRunOwner: typeof getProfileEvidenceExtractionRunOwner;
  resolveAiConfig: typeof resolveJobDeskAiConfig;
  resolveRunSource: typeof resolveProfileEvidenceExtractionRunSource;
  saveRunProgress: typeof saveProfileEvidenceExtractionRunProgress;
  updateRunStatus: typeof updateProfileEvidenceExtractionRunStatus;
  extractChunked: typeof extractProfileEvidenceChunked;
  persistExtraction: typeof persistProfileEvidenceExtraction;
  persistFailure: typeof persistProfileEvidenceFailure;
  markResumeExtracted: typeof markResumeSourceExtracted;
  processNextSegment: typeof processNextProfileEvidenceStepRunnerSegment;
  scheduleEmbeddingsSync: typeof schedulePersonalEmbeddingsSync;
  runAsUser: typeof runWithAuthContext;
};

const productionWorkerDependencies: ProfileEvidenceExtractionWorkerDependencies = {
  claimRunById: claimProfileEvidenceExtractionRunById,
  claimNextRun: claimNextProfileEvidenceExtractionRun,
  completeRun: completeProfileEvidenceExtractionRun,
  extractChunked: extractProfileEvidenceChunked,
  failRun: failProfileEvidenceExtractionRun,
  getRunOwner: getProfileEvidenceExtractionRunOwner,
  markResumeExtracted: markResumeSourceExtracted,
  persistExtraction: persistProfileEvidenceExtraction,
  persistFailure: persistProfileEvidenceFailure,
  processNextSegment: processNextProfileEvidenceStepRunnerSegment,
  resolveAiConfig: resolveJobDeskAiConfig,
  resolveRunSource: resolveProfileEvidenceExtractionRunSource,
  runAsUser: runWithAuthContext,
  saveRunProgress: saveProfileEvidenceExtractionRunProgress,
  scheduleEmbeddingsSync: schedulePersonalEmbeddingsSync,
  updateRunStatus: updateProfileEvidenceExtractionRunStatus,
};

export async function runProfileEvidenceExtractionWorkerOnce(
  workerId = buildWorkerId(),
  dependencies: ProfileEvidenceExtractionWorkerDependencies = productionWorkerDependencies,
) {
  const claim = await dependencies.claimNextRun(workerId);
  if (claim.status !== "claimed") return claim;
  const owner = await dependencies.getRunOwner(claim.run.id);
  if (owner.status !== "ready") {
    await dependencies.failRun({
      runId: claim.run.id,
      workerId,
      failureKind: "missing_workspace",
      failureMessage: "Extraction run workspace is not available.",
      canRetry: false,
    });
    return { status: "failed" as const, reason: "missing_workspace" as const, runId: claim.run.id };
  }

  return dependencies.runAsUser(owner.userId, async () => runClaimedProfileEvidenceExtraction({
    claim,
    dependencies,
    ownerUserId: owner.userId,
    workerId,
  }));
}

export async function runProfileEvidenceExtractionWorkerForRun(
  runId: string,
  workerId = buildWorkerId(),
  dependencies: ProfileEvidenceExtractionWorkerDependencies = productionWorkerDependencies,
) {
  const claim = await dependencies.claimRunById(runId, workerId);
  if (claim.status !== "claimed") return claim;
  const owner = await dependencies.getRunOwner(claim.run.id);
  if (owner.status !== "ready") {
    await dependencies.failRun({
      runId: claim.run.id,
      workerId,
      failureKind: "missing_workspace",
      failureMessage: "Extraction run workspace is not available.",
      canRetry: false,
    });
    return { status: "failed" as const, reason: "missing_workspace" as const, runId: claim.run.id };
  }

  return dependencies.runAsUser(owner.userId, async () => runClaimedProfileEvidenceExtraction({
    claim,
    dependencies,
    ownerUserId: owner.userId,
    workerId,
  }));
}

async function runClaimedProfileEvidenceExtraction(args: {
  claim: ClaimedExtractionRun;
  dependencies: ProfileEvidenceExtractionWorkerDependencies;
  ownerUserId: string | null;
  workerId: string;
}) {
  const { claim, dependencies, workerId } = args;
  const source = await dependencies.resolveRunSource(claim.run.id);
  const replacement = parseReplacementMetadata(claim.run.result?.replacement);
  if (!source?.sourceText.trim()) {
    await dependencies.failRun({
      runId: claim.run.id,
      workerId,
      failureKind: "missing_source",
      failureMessage: "Extraction source text is not available.",
      canRetry: false,
    });
    return { status: "failed" as const, reason: "missing_source" as const, runId: claim.run.id };
  }

  const config = dependencies.resolveAiConfig();
  try {
    const existingState = parseProfileEvidenceStepRunnerState(claim.run.result);
    if (!existingState) {
      await dependencies.updateRunStatus({
        runId: claim.run.id,
        status: "segmenting",
        workerId,
      });
      await dependencies.updateRunStatus({
        runId: claim.run.id,
        status: "extracting_profile",
        workerId,
      });
      const state = initializeProfileEvidenceStepRunnerState({
        sourceId: claim.run.id,
        sourceText: source.sourceText,
      });
      const progress = getProfileEvidenceStepRunnerProgress(state);
      if (progress.hasPendingSegments) {
        const saved = await dependencies.saveRunProgress({
          runId: claim.run.id,
          status: "extracting_evidence",
          workerId,
          result: {
            ...(replacement ? { replacement } : {}),
            ...serializeProfileEvidenceStepRunnerState(state),
            progress,
          },
        });
        return { hasMoreWork: true, run: saved, status: "processing" as const };
      }
      const saved = await dependencies.saveRunProgress({
        runId: claim.run.id,
        status: "validating",
        workerId,
        result: {
          ...(replacement ? { replacement } : {}),
          ...serializeProfileEvidenceStepRunnerState(state),
          progress,
        },
      });
      return { hasMoreWork: true, run: saved, status: "processing" as const };
    }

    const existingProgress = getProfileEvidenceStepRunnerProgress(existingState);
    if (existingProgress.hasPendingSegments) {
      await dependencies.updateRunStatus({
        runId: claim.run.id,
        status: "extracting_evidence",
        workerId,
      });
      const processed = await dependencies.processNextSegment({
        state: existingState,
      });
      const progress = getProfileEvidenceStepRunnerProgress(processed.state);
      const saved = await dependencies.saveRunProgress({
        runId: claim.run.id,
        status: progress.hasPendingSegments ? "extracting_evidence" : "validating",
        workerId,
        result: {
          ...(replacement ? { replacement } : {}),
          ...serializeProfileEvidenceStepRunnerState(processed.state),
          progress,
        },
      });
      return { hasMoreWork: true, run: saved, status: "processing" as const };
    }

    const result = buildProfileEvidenceExtractionFromStepRunnerState(existingState);
    const sectionRetryPayloads = buildSectionRetryPayloadsFromStepRunnerState(existingState, {
      sourceDocumentId: claim.run.sourceDocumentId,
      sourceLabel: claim.run.sourceTitle,
    });
    await dependencies.updateRunStatus({
      runId: claim.run.id,
      status: "validating",
      workerId,
    });

    await dependencies.updateRunStatus({
      runId: claim.run.id,
      status: "saving",
      workerId,
    });
    const persistence = await dependencies.persistExtraction({
      sourceText: source.sourceText,
      sourceTitle: claim.run.sourceTitle,
      sourceDocumentId: claim.run.sourceDocumentId ?? undefined,
      sourceType: claim.run.sourceType === "project-note" ? "project-note" : claim.run.sourceType === "jd-gap-note" ? "jd-gap-note" : "profile-evidence",
      extraction: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      replacement: replacement ?? undefined,
      reviewPayloads: sectionRetryPayloads,
      skill: result.skill,
    });
    if (persistence.status === "saved" && claim.run.resumeSourceVersionId) {
      await dependencies.markResumeExtracted(claim.run.resumeSourceVersionId);
    }
    if (persistence.status === "saved") {
      dependencies.scheduleEmbeddingsSync("profile_evidence_extract_run");
    }
    const completed = await dependencies.completeRun({
      runId: claim.run.id,
      workerId,
      workflowRunId: persistence.status === "saved" ? persistence.workflowRunId : undefined,
      result: {
        evidenceCount: persistence.status === "saved" ? persistence.evidenceCount : result.data.evidence_items.length,
        ...(replacement ? { replacement } : {}),
        projectCount: persistence.status === "saved" ? persistence.projectCount : result.data.project_cards.length,
        storyCount:
          persistence.status === "saved"
            ? persistence.initiativeCount + persistence.portfolioProjectCount
            : result.data.initiatives.length + result.data.portfolio_projects.length,
        workExperienceCount:
          persistence.status === "saved" ? persistence.workExperienceCount : result.data.work_experiences.length,
        sourceTitle: claim.run.sourceTitle,
        type: claim.run.sourceType === "project-note" ? "project" : "resume",
        segmentCount: result.segmentCount,
      },
    });
    return { status: "completed" as const, run: completed };
  } catch (error) {
    const failure = classifyWorkerFailure(error);
    await persistWorkerFailure({
      config,
      error,
      persistFailure: dependencies.persistFailure,
      retryCount: error instanceof JobDeskAiError ? error.retryCount : 0,
      skill:
        claim.run.sourceType === "project-note"
          ? skillRegistry.profileEvidenceExtractionProjectNote
          : skillRegistry.profileEvidenceExtractionResume,
    });
    const failed = await dependencies.failRun({
      runId: claim.run.id,
      workerId,
      failureKind: failure.kind,
      failureMessage: failure.message,
      canRetry: failure.canRetry,
      retryAfterSeconds: failure.retryAfterSeconds,
    });
    return { status: "failed" as const, run: failed };
  }
}

function parseReplacementMetadata(value: unknown): ProfileEvidenceExtractionReplacement | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ProfileEvidenceExtractionReplacement>;
  if (
    typeof candidate.segmentId !== "string" ||
    typeof candidate.segmentText !== "string" ||
    typeof candidate.segmentTextHash !== "string" ||
    typeof candidate.segmentTitle !== "string"
  ) {
    return null;
  }
  return {
    originalRunId: typeof candidate.originalRunId === "string" ? candidate.originalRunId : null,
    sourceDocumentId: typeof candidate.sourceDocumentId === "string" ? candidate.sourceDocumentId : null,
    segmentId: candidate.segmentId,
    segmentText: candidate.segmentText,
    segmentTextHash: candidate.segmentTextHash,
    segmentTitle: candidate.segmentTitle,
  };
}

function classifyWorkerFailure(error: unknown) {
  if (error instanceof JobDeskAiError) {
    const providerTimedOut = error.status === 524 || error.kind === "timeout";
    return {
      canRetry: providerTimedOut || error.kind === "provider_5xx" || error.kind === "rate_limit",
      kind: providerTimedOut ? "provider_timeout" : error.kind,
      message: providerTimedOut
        ? "AI extraction timed out. Your source was saved; retry or split the material."
        : error.message,
      retryAfterSeconds: providerTimedOut ? 10 : undefined,
    };
  }
  return {
    canRetry: false,
    kind: "unknown",
    message: error instanceof Error ? error.message : "Profile evidence extraction failed.",
    retryAfterSeconds: undefined,
  };
}

async function persistWorkerFailure(args: {
  config: ReturnType<typeof resolveJobDeskAiConfig>;
  error: unknown;
  persistFailure: typeof persistProfileEvidenceFailure;
  retryCount: number;
  skill: Parameters<typeof persistProfileEvidenceFailure>[0]["skill"];
}) {
  try {
    await args.persistFailure({
      provider: `openrouter-compatible:${args.config.transport}`,
      model: args.config.model,
      errorKind: args.error instanceof JobDeskAiError ? args.error.kind : "unknown",
      errorMessage: args.error instanceof Error ? args.error.message : "Unknown error.",
      retryCount: args.retryCount,
      skill: args.skill,
    });
  } catch {
    // Failure persistence must not hide the extraction run failure.
  }
}

function buildWorkerId() {
  return `profile-extraction-${process.pid}-${Date.now()}`;
}
