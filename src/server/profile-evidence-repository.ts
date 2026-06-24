import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  evidenceItems,
  enrichmentTaskTargets,
  enrichmentTasks,
  generatedClaims,
  initiatives,
  overlapReviewDecisions,
  portfolioProjects,
  profiles,
  profileFactHistory,
  projectCards,
  resumeSourceVersions,
  sourceDocuments,
  workExperiences,
  workflowRuns,
} from "../db/schema";
import type {
  JobDeskAiFailureKind,
  JobDeskAiSkillBinding,
  JobDeskAiUsage,
} from "../ai/types";
import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import type { ProfileFactPatchRequest } from "../schemas/profile-facts";
import { AllowedUsage } from "../schemas/shared";
import type { FieldTier, SensitivityLevel } from "../schemas/shared";
import {
  retrieveResumeEvidenceForJob,
  type ResumeRetrievalJobContext,
} from "./retrieval-service";
import { buildStarStoryCards, type StarStoryTargetInput } from "./star-story-service";
import { workflowSkillFields } from "./workflow-run-metadata";
import {
  buildExtractionNoteEnrichmentTasks,
  reconcileResumeReviewEnrichmentTasksForSource,
  upsertEnrichmentTasks,
} from "./enrichment-task-repository";
import {
  buildRedactionReport,
  hasResumeSafeDisclosure,
  isPublicSafeText,
} from "./deidentification-service";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";
import { buildParseQuality, sourceParserName, sourceParserVersion } from "./resume-source-parser";
import { buildSourceContentHash } from "./source-document-repository";
import { deleteRebuildSourceChunksForSource, indexSourceChunks } from "./source-chunk-service";

export type ProfileEvidencePersistenceResult =
  | {
      status: "saved";
      workspaceId: string;
      profileId: string;
      sourceDocumentId: string;
      evidenceCount: number;
      projectCount: number;
      workExperienceCount: number;
      initiativeCount: number;
      portfolioProjectCount: number;
      workflowRunId: string;
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    };

type SourceDocumentStore = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update" | "delete">;
type StoryTargetStore = Pick<ReturnType<typeof getDb>, "select">;
type StoryTargetMergeStore = Pick<ReturnType<typeof getDb>, "select" | "update">;

type CanonicalProfileJson = Record<string, unknown>;

type EnrichmentStoryTarget = {
  targetType: "initiative" | "portfolio_project" | "legacy_project";
  targetId: string;
  targetTitle?: string;
  missingFields?: string[];
};

type InitiativeDraft = ProfileEvidenceExtraction["initiatives"][number];

type InitiativeConsolidationResult = {
  initiatives: InitiativeDraft[];
  draftRefRedirects: Map<string, string>;
  extractionNotes: string[];
};

const INITIATIVE_DOMAIN_TOKENS = new Set([
  "activation",
  "analytics",
  "cache",
  "caching",
  "cdk",
  "cloud",
  "dashboard",
  "dashboards",
  "delivery",
  "distributed",
  "experiment",
  "funnel",
  "infrastructure",
  "instrumentation",
  "latency",
  "looker",
  "migration",
  "onboarding",
  "pipeline",
  "provisioning",
  "redis",
  "reliability",
  "reporting",
  "retention",
  "service",
  "session",
  "sql",
]);

export async function persistProfileEvidenceExtraction(args: {
  sourceText: string;
  sourceTitle?: string;
  sourceType?: "profile-evidence" | "project-note" | "jd-gap-note";
  sourceDocumentId?: string;
  target?: EnrichmentStoryTarget;
  extraction: ProfileEvidenceExtraction;
  provider: string;
  model: string;
  usage: JobDeskAiUsage;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}): Promise<ProfileEvidencePersistenceResult> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getOrCreateDefaultWorkspace(tx);
    const now = new Date();
    const title = args.sourceTitle?.trim() || inferSourceTitle(args.extraction, args.sourceText);
    const contentHash = buildSourceContentHash(args.sourceText);
    const parseQuality = buildParseQuality(args.sourceText);
    const sourceDocument = await resolveExtractionSourceDocument({
      contentHash,
      db: tx,
      parseQuality,
      sourceDocumentId: args.sourceDocumentId,
      sourceText: args.sourceText,
      sourceTitle: title,
      sourceType: args.sourceType ?? "profile-evidence",
      workspaceId: workspace.id,
    });
    const enrichmentTarget = args.target
      ? await resolveEnrichmentStoryTarget(tx, {
          target: args.target,
          workspaceId: workspace.id,
        })
      : null;

    const canonicalProfile = toCanonicalProfile(args.extraction.profile, args.sourceText);
    const displayName = args.extraction.profile.name.value;
    const [profile] = await tx
      .insert(profiles)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: sourceDocument.id,
        displayName,
        profileJson: canonicalProfile as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: profiles.id });
    if (!profile) {
      throw new Error("Failed to create profile.");
    }

    const workExperienceDrafts = mergeWorkExperienceDrafts(
      args.extraction.work_experiences,
      profileExperiencesToWorkExperienceDrafts(args.extraction.profile.experience),
    );
    const initiativeConsolidation = consolidateInitiativeDrafts(args.extraction.initiatives);
    const workExperienceIdByDraftId = new Map<string, string>();
    const workExperienceAnchorTexts = new Map<string, string>();
    for (const experience of workExperienceDrafts) {
      const [created] = await tx
        .insert(workExperiences)
        .values({
          workspaceId: workspace.id,
          sourceDocumentId: sourceDocument.id,
          employer: experience.employer,
          roleTitle: experience.role_title,
          team: experience.team,
          location: experience.location,
          startDate: experience.start_date,
          endDate: experience.end_date,
          summary: experience.summary,
          status: experience.status,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: workExperiences.id });
      if (created) {
        workExperienceIdByDraftId.set(buildWorkExperienceDraftKey(experience), created.id);
        workExperienceIdByDraftId.set(experience.employer, created.id);
        workExperienceIdByDraftId.set(experience.role_title, created.id);
        workExperienceAnchorTexts.set(
          created.id,
          [
            experience.employer,
            experience.role_title,
            experience.team,
            experience.summary,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
    }

    const initiativeIdByDraftId = new Map<string, string>();
    const initiativeAnchorTexts = new Map<string, string>();
    if (enrichmentTarget?.targetType === "initiative") {
      await mergeSelectedInitiativeTarget(tx, {
        drafts: initiativeConsolidation.initiatives,
        now,
        sourceDocumentId: sourceDocument.id,
        targetId: enrichmentTarget.targetId,
        targetTitle: args.target?.targetTitle,
        workspaceId: workspace.id,
      });
      for (const initiative of initiativeConsolidation.initiatives) {
        initiativeIdByDraftId.set(initiative.internal_title, enrichmentTarget.targetId);
        if (initiative.external_safe_title) {
          initiativeIdByDraftId.set(initiative.external_safe_title, enrichmentTarget.targetId);
        }
        initiativeAnchorTexts.set(enrichmentTarget.targetId, buildInitiativeAnchorText(initiative));
      }
      applyInitiativeDraftRedirects(initiativeIdByDraftId, initiativeConsolidation.draftRefRedirects);
    } else {
      for (const initiative of initiativeConsolidation.initiatives) {
        const workExperienceId = initiative.work_experience_ref
          ? workExperienceIdByDraftId.get(initiative.work_experience_ref) ?? null
          : null;
        const [created] = await tx
          .insert(initiatives)
          .values({
            workspaceId: workspace.id,
            workExperienceId,
            sourceDocumentId: sourceDocument.id,
            internalTitle: initiative.internal_title,
            externalSafeTitle: initiative.external_safe_title,
            context: initiative.context,
            problem: initiative.problem,
            role: initiative.role,
            actions: initiative.actions,
            results: initiative.results,
            metrics: initiative.metrics as Array<Record<string, unknown>>,
            technologies: initiative.technologies,
            stakeholders: initiative.stakeholders,
            externalSafeSummary: initiative.external_safe_summary,
            sensitivityLevel: initiative.sensitivity_level,
            needsRedactionReview: initiative.needs_redaction_review ? 1 : 0,
            status: initiative.status,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: initiatives.id });
        if (created) {
          initiativeIdByDraftId.set(initiative.internal_title, created.id);
          if (initiative.external_safe_title) {
            initiativeIdByDraftId.set(initiative.external_safe_title, created.id);
          }
          initiativeAnchorTexts.set(created.id, buildInitiativeAnchorText(initiative));
        }
      }
      applyInitiativeDraftRedirects(initiativeIdByDraftId, initiativeConsolidation.draftRefRedirects);
    }

    const portfolioProjectIdByDraftId = new Map<string, string>();
    const portfolioProjectAnchorTexts = new Map<string, string>();
    if (enrichmentTarget?.targetType === "portfolio_project") {
      await mergeSelectedPortfolioProjectTarget(tx, {
        drafts: args.extraction.portfolio_projects,
        now,
        sourceDocumentId: sourceDocument.id,
        targetId: enrichmentTarget.targetId,
        targetTitle: args.target?.targetTitle,
        workspaceId: workspace.id,
      });
      for (const project of args.extraction.portfolio_projects) {
        portfolioProjectIdByDraftId.set(project.title, enrichmentTarget.targetId);
        if (project.external_safe_title) {
          portfolioProjectIdByDraftId.set(project.external_safe_title, enrichmentTarget.targetId);
        }
        portfolioProjectAnchorTexts.set(enrichmentTarget.targetId, buildPortfolioProjectAnchorText(project));
      }
    } else {
      for (const project of args.extraction.portfolio_projects) {
        const [created] = await tx
          .insert(portfolioProjects)
          .values({
            workspaceId: workspace.id,
            sourceDocumentId: sourceDocument.id,
            projectType: project.project_type,
            title: project.title,
            externalSafeTitle: project.external_safe_title,
            context: project.context,
            problem: project.problem,
            role: project.role,
            actions: project.actions,
            results: project.results,
            metrics: project.metrics as Array<Record<string, unknown>>,
            technologies: project.technologies,
            stakeholders: project.stakeholders,
            externalSafeSummary: project.external_safe_summary,
            sensitivityLevel: project.sensitivity_level,
            needsRedactionReview: project.needs_redaction_review ? 1 : 0,
            status: project.status,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: portfolioProjects.id });
        if (created) {
          portfolioProjectIdByDraftId.set(project.title, created.id);
          if (project.external_safe_title) {
            portfolioProjectIdByDraftId.set(project.external_safe_title, created.id);
          }
          portfolioProjectAnchorTexts.set(created.id, buildPortfolioProjectAnchorText(project));
        }
      }
    }

    const projectIdByDraftId = new Map<string, string>();
    if (enrichmentTarget?.targetType === "legacy_project") {
      await mergeSelectedLegacyProjectTarget(tx, {
        drafts: args.extraction.project_cards,
        now,
        targetId: enrichmentTarget.targetId,
        targetTitle: args.target?.targetTitle,
        workspaceId: workspace.id,
      });
      for (const project of args.extraction.project_cards) {
        projectIdByDraftId.set(project.title, enrichmentTarget.targetId);
      }
    } else {
      for (const project of args.extraction.project_cards) {
        const [created] = await tx
          .insert(projectCards)
          .values({
            workspaceId: workspace.id,
            title: project.title,
            context: project.context,
            problem: project.problem,
            role: project.role,
            actions: project.actions,
            results: project.results,
            metrics: project.metrics as Array<Record<string, unknown>>,
            technologies: project.technologies,
            stakeholders: project.stakeholders,
            publicSafeSummary: project.public_safe_summary,
            sensitivityLevel: project.sensitivity_level,
            status: project.status,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: projectCards.id });
        if (created) {
          projectIdByDraftId.set(project.title, created.id);
        }
      }
    }

    const reconciliationAnchors: Array<{
      evidenceItemId?: string | null;
      workExperienceId?: string | null;
      initiativeId?: string | null;
      portfolioProjectId?: string | null;
      text: string;
      sourceQuote?: string | null;
    }> = [];
    for (const [id, text] of workExperienceAnchorTexts) {
      reconciliationAnchors.push({ workExperienceId: id, text });
    }
    for (const [id, text] of initiativeAnchorTexts) {
      reconciliationAnchors.push({ initiativeId: id, text });
    }
    for (const [id, text] of portfolioProjectAnchorTexts) {
      reconciliationAnchors.push({ portfolioProjectId: id, text });
    }

    if (args.extraction.evidence_items.length > 0) {
      const insertedEvidence = await tx.insert(evidenceItems).values(
        args.extraction.evidence_items.map((item) => {
          const guardrail = evaluateEvidenceGuardrails(item, args.sourceText);
          const mappedProjectId = item.related_project_id
            ? projectIdByDraftId.get(item.related_project_id) ?? null
            : null;
          const mappedInitiativeId = item.related_initiative_id
            ? initiativeIdByDraftId.get(item.related_initiative_id) ?? null
            : null;
          const mappedPortfolioProjectId = item.related_portfolio_project_id
            ? portfolioProjectIdByDraftId.get(item.related_portfolio_project_id) ?? null
            : null;
          const mappedWorkExperienceId = item.related_work_experience_id
            ? workExperienceIdByDraftId.get(item.related_work_experience_id) ?? null
            : null;
          const preferredProjectId =
            enrichmentTarget?.targetType === "legacy_project"
              ? enrichmentTarget.targetId
              : mappedProjectId;
          const candidateInitiativeId =
            enrichmentTarget?.targetType === "initiative"
              ? enrichmentTarget.targetId
              : mappedInitiativeId;
          const candidatePortfolioProjectId =
            enrichmentTarget?.targetType === "portfolio_project"
              ? enrichmentTarget.targetId
              : mappedPortfolioProjectId;
          const preferredInitiativeId = candidateInitiativeId;
          const preferredPortfolioProjectId = preferredInitiativeId
            ? null
            : candidatePortfolioProjectId;
          const preferredWorkExperienceId =
            (preferredProjectId || preferredInitiativeId || preferredPortfolioProjectId)
              ? null
              : mappedWorkExperienceId;
          const publicSafeSummary = buildPublicSafeSummaryCandidate(item);
          return {
            workspaceId: workspace.id,
            sourceDocumentId: sourceDocument.id,
            text: item.text,
            sourceQuote: item.source_quote,
            evidenceType: item.evidence_type,
            metrics: guardrail.metrics,
            sensitivityLevel: item.sensitivity_level,
            allowedUsage: item.allowed_usage,
            publicSafeSummary,
            status: item.status,
            relatedProjectId: preferredProjectId,
            relatedWorkExperienceId: preferredWorkExperienceId,
            relatedInitiativeId: preferredInitiativeId,
            relatedPortfolioProjectId: preferredPortfolioProjectId,
            needsUserConfirmation: guardrail.needsUserConfirmation ? 1 : 0,
            createdAt: now,
            updatedAt: now,
          };
        }),
      ).returning({
        id: evidenceItems.id,
        relatedWorkExperienceId: evidenceItems.relatedWorkExperienceId,
        relatedInitiativeId: evidenceItems.relatedInitiativeId,
        relatedPortfolioProjectId: evidenceItems.relatedPortfolioProjectId,
        text: evidenceItems.text,
        sourceQuote: evidenceItems.sourceQuote,
      });
      for (const item of insertedEvidence) {
        reconciliationAnchors.push({
          evidenceItemId: item.id,
          initiativeId: item.relatedInitiativeId,
          portfolioProjectId: item.relatedPortfolioProjectId,
          workExperienceId: item.relatedWorkExperienceId,
          sourceQuote: item.sourceQuote,
          text: item.text,
        });
      }
    }

    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        workflowType: "profile-evidence-extraction",
        status: "succeeded",
        provider: args.provider,
        model: args.model,
        ...workflowSkillFields(args.skill),
        inputTokens: args.usage.inputTokens ?? null,
        outputTokens: args.usage.outputTokens ?? null,
        totalTokens: args.usage.totalTokens ?? null,
        retryCount: args.retryCount,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });
    if (!workflowRun) {
      throw new Error("Failed to create workflow run.");
    }

    await upsertEnrichmentTasks(tx, {
      workspaceId: workspace.id,
      now,
      tasks: buildExtractionNoteEnrichmentTasks({
        sourceTitle: title,
        notes: args.extraction.extraction_notes,
      }),
    });
    if ((args.sourceType ?? "profile-evidence") === "profile-evidence" && args.sourceDocumentId) {
      const resumeSource = await resolveResumeSourceVersionForSourceDocument(tx, {
        sourceDocumentId: args.sourceDocumentId,
        workspaceId: workspace.id,
      });
      if (resumeSource) {
        await reconcileResumeReviewEnrichmentTasksForSource(tx, {
          anchors: reconciliationAnchors,
          now,
          resumeSourceVersionId: resumeSource.id,
          workspaceId: workspace.id,
        });
      }
    }

    await deleteRebuildSourceChunksForSource({
      db: tx,
      sourceDocumentId: sourceDocument.id,
      workspaceId: workspace.id,
    });

    return {
      status: "saved",
      workspaceId: workspace.id,
      profileId: profile.id,
      sourceDocumentId: sourceDocument.id,
      evidenceCount: args.extraction.evidence_items.length,
      projectCount: args.extraction.project_cards.length,
      workExperienceCount: workExperienceDrafts.length,
      initiativeCount: initiativeConsolidation.initiatives.length,
      portfolioProjectCount: args.extraction.portfolio_projects.length,
      workflowRunId: workflowRun.id,
    };
  });
}

function buildPublicSafeSummaryCandidate(
  item: ProfileEvidenceExtraction["evidence_items"][number],
) {
  const providerSummary = item.public_safe_summary?.trim();
  if (providerSummary && isPublicSafeText(providerSummary)) return providerSummary;
  const text = item.text.trim();
  if (
    item.evidence_type !== "inferred" &&
    item.sensitivity_level !== "sensitive" &&
    isPublicSafeText(text)
  ) {
    return text;
  }
  return null;
}

async function resolveExtractionSourceDocument(args: {
  db: SourceDocumentStore;
  workspaceId: string;
  sourceDocumentId?: string;
  sourceType: "profile-evidence" | "project-note" | "jd-gap-note";
  sourceTitle: string;
  sourceText: string;
  contentHash: string;
  parseQuality: ReturnType<typeof buildParseQuality>;
}) {
  const now = new Date();
  if (args.sourceDocumentId) {
    const [existing] = await args.db
      .select()
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.workspaceId, args.workspaceId),
          eq(sourceDocuments.id, args.sourceDocumentId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error("Source document not found for this workspace.");
    }
    if (existing.contentHash && existing.contentHash !== args.contentHash) {
      throw new Error("Source document text does not match the parsed source.");
    }
    const [updated] = await args.db
      .update(sourceDocuments)
      .set({
        sourceType: args.sourceType,
        lifecycleStatus: "extracted",
        updatedAt: now,
      })
      .where(
        and(
          eq(sourceDocuments.workspaceId, args.workspaceId),
          eq(sourceDocuments.id, args.sourceDocumentId),
        ),
      )
      .returning({ id: sourceDocuments.id });
    if (!updated) {
      throw new Error("Failed to update parsed source lifecycle.");
    }
    await deleteRebuildSourceChunksForSource({
      db: args.db,
      sourceDocumentId: args.sourceDocumentId,
      workspaceId: args.workspaceId,
    });
    return updated;
  }

  const [sourceDocument] = await args.db
    .insert(sourceDocuments)
    .values({
      workspaceId: args.workspaceId,
      sourceType: args.sourceType,
      title: args.sourceTitle,
      contentText: args.sourceText,
      contentHash: args.contentHash,
      parserName: sourceParserName,
      parserVersion: sourceParserVersion,
      parseStatus: args.parseQuality.status,
      parseWarnings: args.parseQuality.warnings,
      charCount: args.parseQuality.charCount,
      wordCount: args.parseQuality.wordCount,
      lifecycleStatus: "extracted",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: sourceDocuments.id });
  if (!sourceDocument) {
    throw new Error("Failed to create profile source document.");
  }
  await indexSourceChunks({
    db: args.db,
    workspaceId: args.workspaceId,
    sourceDocumentId: sourceDocument.id,
  });
  return sourceDocument;
}

async function resolveResumeSourceVersionForSourceDocument(
  db: Pick<ReturnType<typeof getDb>, "select">,
  args: {
    sourceDocumentId: string;
    workspaceId: string;
  },
) {
  const [resumeSource] = await db
    .select({ id: resumeSourceVersions.id })
    .from(resumeSourceVersions)
    .where(
      and(
        eq(resumeSourceVersions.workspaceId, args.workspaceId),
        eq(resumeSourceVersions.sourceDocumentId, args.sourceDocumentId),
      ),
    )
    .limit(1);
  return resumeSource ?? null;
}

function buildInitiativeAnchorText(
  initiative: ProfileEvidenceExtraction["initiatives"][number],
) {
  return [
    initiative.internal_title,
    initiative.external_safe_title,
    initiative.context,
    initiative.problem,
    initiative.role,
    ...initiative.actions,
    ...initiative.results,
    ...initiative.technologies,
    ...(initiative.stakeholders ?? []),
    initiative.external_safe_summary,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildPortfolioProjectAnchorText(
  project: ProfileEvidenceExtraction["portfolio_projects"][number],
) {
  return [
    project.title,
    project.external_safe_title,
    project.context,
    project.problem,
    project.role,
    ...project.actions,
    ...project.results,
    ...project.technologies,
    ...(project.stakeholders ?? []),
    project.external_safe_summary,
  ]
    .filter(Boolean)
    .join(" ");
}

export function consolidateInitiativeDrafts(
  drafts: InitiativeDraft[],
): InitiativeConsolidationResult {
  const draftRefRedirects = new Map<string, string>();
  const extractionNotes: string[] = [];
  if (drafts.length < 2) return { initiatives: drafts, draftRefRedirects, extractionNotes };

  const pending = [...drafts];
  const initiatives: InitiativeDraft[] = [];
  while (pending.length > 0) {
    const seed = pending.shift()!;
    const cluster = [seed];
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index]!;
        const confidence = cluster.some(
          (member) => scoreInitiativeMergeConfidence(member, candidate) === "high",
        );
        if (confidence) {
          cluster.push(candidate);
          pending.splice(index, 1);
          changed = true;
        }
      }
    }
    if (cluster.length === 1) {
      initiatives.push(seed);
      continue;
    }

    const merged = mergeInitiativeDraftCluster(cluster);
    initiatives.push(merged);
    for (const draft of cluster) {
      for (const ref of initiativeDraftRefs(draft)) {
        draftRefRedirects.set(ref, merged.internal_title);
      }
    }
    extractionNotes.push(
      `These story fragments were merged; please review: ${cluster
        .map((draft) => draft.internal_title)
        .join(" / ")}.`,
    );
  }
  return { initiatives, draftRefRedirects, extractionNotes };
}

function applyInitiativeDraftRedirects(
  initiativeIdByDraftId: Map<string, string>,
  draftRefRedirects: Map<string, string>,
) {
  for (const [oldRef, mergedRef] of draftRefRedirects) {
    const mergedId = initiativeIdByDraftId.get(mergedRef);
    if (mergedId) initiativeIdByDraftId.set(oldRef, mergedId);
  }
}

function scoreInitiativeMergeConfidence(
  first: InitiativeDraft,
  second: InitiativeDraft,
): "none" | "medium" | "high" {
  if (!sameKnownWorkExperienceRef(first.work_experience_ref, second.work_experience_ref)) {
    return "none";
  }
  const firstTokens = initiativeSignalTokens(first);
  const secondTokens = initiativeSignalTokens(second);
  const sharedTokens = countSetOverlap(firstTokens.all, secondTokens.all);
  const sharedDomainTokens = countSetOverlap(firstTokens.domain, secondTokens.domain);
  const sharedTechnologies = countSetOverlap(firstTokens.technologies, secondTokens.technologies);
  const titleOverlap = countSetOverlap(firstTokens.title, secondTokens.title);
  const infrastructurePerformancePair =
    (hasInfrastructureSignal(firstTokens) && hasPerformanceCacheSignal(secondTokens)) ||
    (hasInfrastructureSignal(secondTokens) && hasPerformanceCacheSignal(firstTokens));
  const complementarySignals =
    hasAny(firstTokens.technologies) !== hasAny(secondTokens.technologies) ||
    hasAny(firstTokens.outcome) !== hasAny(secondTokens.outcome) ||
    hasAny(firstTokens.action) !== hasAny(secondTokens.action);

  if (
    sharedDomainTokens >= 2 &&
    sharedTokens >= 4 &&
    (sharedTechnologies >= 1 || titleOverlap >= 1 || complementarySignals)
  ) {
    return "high";
  }
  if (infrastructurePerformancePair && sharedDomainTokens >= 1) return "high";
  if (sharedDomainTokens >= 2 && sharedTokens >= 3) return "medium";
  return "none";
}

function mergeInitiativeDraftCluster(cluster: InitiativeDraft[]): InitiativeDraft {
  const title = pickMostCompleteTitle(cluster);
  const sensitivityLevel = maxSensitivity(cluster.map((draft) => draft.sensitivity_level));
  return {
    ...cluster[0]!,
    internal_title: title,
    external_safe_title: preferFirstText(cluster.map((draft) => draft.external_safe_title)),
    context: mergeTextFields(cluster.map((draft) => draft.context)),
    problem: mergeTextFields(cluster.map((draft) => draft.problem)),
    role: mergeTextFields(cluster.map((draft) => draft.role)),
    actions: mergeStringValues([], cluster.flatMap((draft) => draft.actions)),
    results: mergeStringValues([], cluster.flatMap((draft) => draft.results)),
    metrics: mergeInitiativeMetrics(cluster.flatMap((draft) => draft.metrics)),
    technologies: mergeStringValues([], cluster.flatMap((draft) => draft.technologies)),
    stakeholders: mergeStringValues([], cluster.flatMap((draft) => draft.stakeholders ?? [])),
    external_safe_summary: preferFirstText(cluster.map((draft) => draft.external_safe_summary)),
    sensitivity_level: sensitivityLevel,
    needs_redaction_review: cluster.some((draft) => draft.needs_redaction_review),
    status: "pending",
    work_experience_ref: cluster[0]!.work_experience_ref,
  };
}

function initiativeDraftRefs(draft: InitiativeDraft) {
  return [draft.internal_title, draft.external_safe_title].filter(
    (value): value is string => hasText(value),
  );
}

function initiativeSignalTokens(draft: InitiativeDraft) {
  const title = new Set(tokenizeInitiativeText(draft.internal_title));
  const technologies = new Set(draft.technologies.flatMap(tokenizeInitiativeText));
  const outcome = new Set(draft.results.flatMap(tokenizeInitiativeText));
  const action = new Set(draft.actions.flatMap(tokenizeInitiativeText));
  const all = new Set(
    [
      draft.internal_title,
      draft.external_safe_title,
      draft.context,
      draft.problem,
      draft.role,
      draft.external_safe_summary,
      ...draft.actions,
      ...draft.results,
      ...draft.technologies,
      ...(draft.stakeholders ?? []),
    ].flatMap((value) => tokenizeInitiativeText(value ?? "")),
  );
  const domain = new Set([...all].filter((token) => INITIATIVE_DOMAIN_TOKENS.has(token)));
  return { action, all, domain, outcome, technologies, title };
}

function hasInfrastructureSignal(tokens: ReturnType<typeof initiativeSignalTokens>) {
  return ["aws", "cdk", "cloud", "infrastructure", "provision", "provisioning"].some((token) =>
    tokens.all.has(token),
  );
}

function hasPerformanceCacheSignal(tokens: ReturnType<typeof initiativeSignalTokens>) {
  return ["cache", "caching", "delivery", "distributed", "latency", "service"].some((token) =>
    tokens.all.has(token),
  );
}

function tokenizeInitiativeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .map(normalizeInitiativeToken);
}

function normalizeInitiativeToken(token: string) {
  if (["cached", "caches", "caching"].includes(token)) return "cache";
  if (["optimized", "optimization", "optimizing"].includes(token)) return "optimize";
  if (["provisioned", "provisioning"].includes(token)) return "provision";
  return token;
}

function countSetOverlap(first: Set<string>, second: Set<string>) {
  let count = 0;
  for (const item of first) {
    if (second.has(item)) count += 1;
  }
  return count;
}

function hasAny(values: Set<string>) {
  return values.size > 0;
}

function sameKnownWorkExperienceRef(first: string | null | undefined, second: string | null | undefined) {
  if (!hasText(first) || !hasText(second)) return false;
  return normalizeMatchText(first!) === normalizeMatchText(second!);
}

function pickMostCompleteTitle(cluster: InitiativeDraft[]) {
  return [...cluster].sort((left, right) => {
    const leftScore =
      tokenizeInitiativeText(left.internal_title).length +
      left.actions.length * 2 +
      left.results.length * 2 +
      left.technologies.length;
    const rightScore =
      tokenizeInitiativeText(right.internal_title).length +
      right.actions.length * 2 +
      right.results.length * 2 +
      right.technologies.length;
    return rightScore - leftScore;
  })[0]!.internal_title;
}

function preferFirstText(values: Array<string | null | undefined>) {
  return values.find((value): value is string => hasText(value))?.trim() ?? null;
}

function mergeTextFields(values: Array<string | null | undefined>) {
  const unique = mergeStringValues([], values.filter((value): value is string => hasText(value)));
  if (unique.length === 0) return null;
  return unique.join(" ");
}

function mergeInitiativeMetrics(metrics: InitiativeDraft["metrics"]) {
  const values = new Map<string, InitiativeDraft["metrics"][number]>();
  for (const metric of metrics) {
    values.set(JSON.stringify(metric), metric);
  }
  return Array.from(values.values());
}

function maxSensitivity(values: SensitivityLevel[]) {
  if (values.includes("sensitive")) return "sensitive";
  if (values.includes("private")) return "private";
  return "public_safe";
}

async function resolveEnrichmentStoryTarget(
  db: StoryTargetStore,
  args: {
    target: EnrichmentStoryTarget;
    workspaceId: string;
  },
) {
  if (args.target.targetType === "initiative") {
    const [target] = await db
      .select({ id: initiatives.id, status: initiatives.status })
      .from(initiatives)
      .where(
        and(
          eq(initiatives.workspaceId, args.workspaceId),
          eq(initiatives.id, args.target.targetId),
        ),
      )
      .limit(1);
    if (!target) throw new Error("Target initiative not found for this workspace.");
    if (target.status === "rejected") throw new Error("Target initiative has been rejected.");
    return { targetId: target.id, targetType: args.target.targetType } as const;
  }
  if (args.target.targetType === "portfolio_project") {
    const [target] = await db
      .select({ id: portfolioProjects.id, status: portfolioProjects.status })
      .from(portfolioProjects)
      .where(
        and(
          eq(portfolioProjects.workspaceId, args.workspaceId),
          eq(portfolioProjects.id, args.target.targetId),
        ),
      )
      .limit(1);
    if (!target) throw new Error("Target portfolio project not found for this workspace.");
    if (target.status === "rejected") throw new Error("Target portfolio project has been rejected.");
    return { targetId: target.id, targetType: args.target.targetType } as const;
  }
  const [target] = await db
    .select({ id: projectCards.id, status: projectCards.status })
    .from(projectCards)
    .where(
      and(
        eq(projectCards.workspaceId, args.workspaceId),
        eq(projectCards.id, args.target.targetId),
      ),
    )
    .limit(1);
  if (!target) throw new Error("Target project not found for this workspace.");
  if (target.status === "rejected") throw new Error("Target project has been rejected.");
  return { targetId: target.id, targetType: args.target.targetType } as const;
}

async function mergeSelectedInitiativeTarget(
  db: StoryTargetMergeStore,
  args: {
    drafts: ProfileEvidenceExtraction["initiatives"];
    now: Date;
    sourceDocumentId: string;
    targetId: string;
    targetTitle?: string;
    workspaceId: string;
  },
) {
  const draft = pickBestTargetDraft(args.drafts, args.targetTitle);
  if (!draft) return;
  const [current] = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, args.workspaceId), eq(initiatives.id, args.targetId)))
    .limit(1);
  if (!current) throw new Error("Target initiative not found for this workspace.");

  await db
    .update(initiatives)
    .set({
      sourceDocumentId: current.sourceDocumentId ?? args.sourceDocumentId,
      externalSafeTitle: preferExistingText(current.externalSafeTitle, draft.external_safe_title),
      context: preferExistingText(current.context, draft.context),
      problem: preferExistingText(current.problem, draft.problem),
      role: preferExistingText(current.role, draft.role),
      actions: mergeStringValues(current.actions, draft.actions),
      results: mergeStringValues(current.results, draft.results),
      metrics: mergeRecordValues(current.metrics, draft.metrics),
      technologies: mergeStringValues(current.technologies, draft.technologies),
      stakeholders: mergeStringValues(current.stakeholders, draft.stakeholders),
      externalSafeSummary: preferExistingText(
        current.externalSafeSummary,
        draft.external_safe_summary,
      ),
      sensitivityLevel: current.sensitivityLevel ?? draft.sensitivity_level,
      needsRedactionReview:
        current.needsRedactionReview === 1 || draft.needs_redaction_review ? 1 : 0,
      updatedAt: args.now,
    })
    .where(and(eq(initiatives.workspaceId, args.workspaceId), eq(initiatives.id, args.targetId)));
}

async function mergeSelectedPortfolioProjectTarget(
  db: StoryTargetMergeStore,
  args: {
    drafts: ProfileEvidenceExtraction["portfolio_projects"];
    now: Date;
    sourceDocumentId: string;
    targetId: string;
    targetTitle?: string;
    workspaceId: string;
  },
) {
  const draft = pickBestTargetDraft(args.drafts, args.targetTitle);
  if (!draft) return;
  const [current] = await db
    .select()
    .from(portfolioProjects)
    .where(
      and(
        eq(portfolioProjects.workspaceId, args.workspaceId),
        eq(portfolioProjects.id, args.targetId),
      ),
    )
    .limit(1);
  if (!current) throw new Error("Target portfolio project not found for this workspace.");

  await db
    .update(portfolioProjects)
    .set({
      sourceDocumentId: current.sourceDocumentId ?? args.sourceDocumentId,
      externalSafeTitle: preferExistingText(current.externalSafeTitle, draft.external_safe_title),
      context: preferExistingText(current.context, draft.context),
      problem: preferExistingText(current.problem, draft.problem),
      role: preferExistingText(current.role, draft.role),
      actions: mergeStringValues(current.actions, draft.actions),
      results: mergeStringValues(current.results, draft.results),
      metrics: mergeRecordValues(current.metrics, draft.metrics),
      technologies: mergeStringValues(current.technologies, draft.technologies),
      stakeholders: mergeStringValues(current.stakeholders, draft.stakeholders),
      externalSafeSummary: preferExistingText(
        current.externalSafeSummary,
        draft.external_safe_summary,
      ),
      sensitivityLevel: current.sensitivityLevel ?? draft.sensitivity_level,
      needsRedactionReview:
        current.needsRedactionReview === 1 || draft.needs_redaction_review ? 1 : 0,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(portfolioProjects.workspaceId, args.workspaceId),
        eq(portfolioProjects.id, args.targetId),
      ),
    );
}

async function mergeSelectedLegacyProjectTarget(
  db: StoryTargetMergeStore,
  args: {
    drafts: ProfileEvidenceExtraction["project_cards"];
    now: Date;
    targetId: string;
    targetTitle?: string;
    workspaceId: string;
  },
) {
  const draft = pickBestTargetDraft(args.drafts, args.targetTitle);
  if (!draft) return;
  const [current] = await db
    .select()
    .from(projectCards)
    .where(and(eq(projectCards.workspaceId, args.workspaceId), eq(projectCards.id, args.targetId)))
    .limit(1);
  if (!current) throw new Error("Target project not found for this workspace.");

  await db
    .update(projectCards)
    .set({
      context: preferExistingText(current.context, draft.context),
      problem: preferExistingText(current.problem, draft.problem),
      role: preferExistingText(current.role, draft.role),
      actions: mergeStringValues(current.actions, draft.actions),
      results: mergeStringValues(current.results, draft.results),
      metrics: mergeRecordValues(current.metrics, draft.metrics),
      technologies: mergeStringValues(current.technologies, draft.technologies),
      stakeholders: mergeStringValues(current.stakeholders, draft.stakeholders),
      publicSafeSummary: preferExistingText(current.publicSafeSummary, draft.public_safe_summary),
      sensitivityLevel: current.sensitivityLevel ?? draft.sensitivity_level,
      updatedAt: args.now,
    })
    .where(and(eq(projectCards.workspaceId, args.workspaceId), eq(projectCards.id, args.targetId)));
}

function pickBestTargetDraft<T extends { title?: string; internal_title?: string }>(
  drafts: T[],
  targetTitle?: string,
) {
  if (!targetTitle) return drafts[0] ?? null;
  const normalizedTarget = normalizeMatchText(targetTitle);
  return (
    drafts.find((draft) =>
      [draft.title, draft.internal_title].some(
        (candidate) => candidate && normalizeMatchText(candidate) === normalizedTarget,
      ),
    ) ??
    drafts[0] ??
    null
  );
}

function preferExistingText(existing: string | null | undefined, incoming: string | null | undefined) {
  return hasText(existing) ? existing : hasText(incoming) ? incoming!.trim() : existing ?? null;
}

function mergeStringValues(existing: string[] | null | undefined, incoming: string[] | null | undefined) {
  const values = new Map<string, string>();
  for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!hasText(value)) continue;
    const trimmed = value.trim();
    values.set(normalizeMatchText(trimmed), trimmed);
  }
  return Array.from(values.values());
}

function mergeRecordValues(
  existing: Array<Record<string, unknown>> | null | undefined,
  incoming: Array<Record<string, unknown>> | null | undefined,
) {
  const values = new Map<string, Record<string, unknown>>();
  for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
    values.set(JSON.stringify(value), value);
  }
  return Array.from(values.values());
}

function hasText(value: string | null | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function normalizeMatchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function persistProfileEvidenceFailure(args: {
  provider: string;
  model: string;
  errorKind: JobDeskAiFailureKind | "unknown";
  errorMessage: string;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const now = new Date();
  const [workflowRun] = await db
    .insert(workflowRuns)
    .values({
      workspaceId: workspace.id,
      workflowType: "profile-evidence-extraction",
      status: "failed",
      provider: args.provider,
      model: args.model,
      ...workflowSkillFields(args.skill),
      retryCount: args.retryCount,
      errorKind: args.errorKind,
      errorMessage: args.errorMessage.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***"),
      startedAt: now,
      finishedAt: now,
    })
    .returning({ id: workflowRuns.id });
  return workflowRun
    ? ({ status: "saved" as const, workflowRunId: workflowRun.id })
    : ({ status: "skipped" as const, reason: "missing_database_url" as const });
}

export async function getRecentEvidenceLibrary(limit = 8) {
  if (!hasDatabaseUrl()) {
    return {
      profile: null,
      evidenceItems: [],
      workExperiences: [],
      initiatives: [],
      portfolioProjects: [],
      projectCards: [],
    };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.workspaceId, workspace.id))
    .orderBy(desc(profiles.updatedAt))
    .limit(1);
  const profileFactSources = profile
    ? await db
        .select()
        .from(profileFactHistory)
        .where(and(eq(profileFactHistory.workspaceId, workspace.id), eq(profileFactHistory.profileId, profile.id)))
        .orderBy(desc(profileFactHistory.createdAt))
        .limit(40)
    : [];
  const evidence = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.workspaceId, workspace.id))
    .orderBy(desc(evidenceItems.updatedAt))
    .limit(limit);
  const experiences = await db
    .select()
    .from(workExperiences)
    .where(and(eq(workExperiences.workspaceId, workspace.id), ne(workExperiences.status, "rejected")))
    .orderBy(desc(workExperiences.updatedAt))
    .limit(limit);
  const initiativeRows = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, workspace.id), ne(initiatives.status, "rejected")))
    .orderBy(desc(initiatives.updatedAt))
    .limit(limit);
  const portfolioProjectRows = await db
    .select()
    .from(portfolioProjects)
    .where(and(eq(portfolioProjects.workspaceId, workspace.id), ne(portfolioProjects.status, "rejected")))
    .orderBy(desc(portfolioProjects.updatedAt))
    .limit(limit);
  const projects = await db
    .select()
    .from(projectCards)
    .where(and(eq(projectCards.workspaceId, workspace.id), ne(projectCards.status, "rejected")))
    .orderBy(desc(projectCards.updatedAt))
    .limit(limit);

  return {
    profile: profile
      ? {
          id: profile.id,
          displayName: profile.displayName,
          updatedAt: profile.updatedAt.toISOString(),
          profile: profile.profileJson,
          fact_sources: summarizeProfileFactSources(profileFactSources),
        }
      : null,
    evidenceItems: evidence.map((item) => ({
      id: item.id,
      text: item.text,
      source_quote: item.sourceQuote,
      source_document_id: item.sourceDocumentId,
      evidence_type: item.evidenceType,
      sensitivity_level: item.sensitivityLevel,
      allowed_usage: item.allowedUsage,
      public_safe_summary: item.publicSafeSummary,
      status: item.status,
      needs_user_confirmation: item.needsUserConfirmation === 1,
      related_project_id: item.relatedProjectId,
      related_work_experience_id: item.relatedWorkExperienceId,
      related_initiative_id: item.relatedInitiativeId,
      related_portfolio_project_id: item.relatedPortfolioProjectId,
      provenance: buildLibraryItemProvenance({
        sourceDocumentId: item.sourceDocumentId,
        sourceType: item.sourceDocumentId ? "source_document" : "manual_or_generated",
      }),
      target_eligibility: buildEvidenceTargetEligibility(item),
      updatedAt: item.updatedAt.toISOString(),
    })),
    workExperiences: experiences.map((experience) => ({
      id: experience.id,
      employer: experience.employer,
      role_title: experience.roleTitle,
      team: experience.team,
      location: experience.location,
      start_date: experience.startDate,
      end_date: experience.endDate,
      summary: experience.summary,
      status: experience.status,
      provenance: buildLibraryItemProvenance({
        sourceDocumentId: experience.sourceDocumentId,
        sourceType: experience.sourceDocumentId ? "source_document" : "manual_or_generated",
      }),
      target_eligibility: buildCanonicalTargetEligibility(experience.status),
      updatedAt: experience.updatedAt.toISOString(),
    })),
    initiatives: initiativeRows.map((initiative) => ({
      id: initiative.id,
      work_experience_id: initiative.workExperienceId,
      internal_title: initiative.internalTitle,
      external_safe_title: initiative.externalSafeTitle,
      context: initiative.context,
      problem: initiative.problem,
      role: initiative.role,
      actions: initiative.actions,
      results: initiative.results,
      metrics: initiative.metrics,
      technologies: initiative.technologies,
      stakeholders: initiative.stakeholders,
      external_safe_summary: initiative.externalSafeSummary,
      sensitivity_level: initiative.sensitivityLevel,
      needs_redaction_review: initiative.needsRedactionReview === 1,
      status: initiative.status,
      source_document_id: initiative.sourceDocumentId,
      provenance: buildLibraryItemProvenance({
        sourceDocumentId: initiative.sourceDocumentId,
        sourceType: initiative.sourceDocumentId ? "source_document" : "manual_or_generated",
      }),
      target_eligibility: buildCanonicalTargetEligibility(initiative.status),
      updatedAt: initiative.updatedAt.toISOString(),
    })),
    portfolioProjects: portfolioProjectRows.map((project) => ({
      id: project.id,
      project_type: project.projectType,
      title: project.title,
      external_safe_title: project.externalSafeTitle,
      context: project.context,
      problem: project.problem,
      role: project.role,
      actions: project.actions,
      results: project.results,
      metrics: project.metrics,
      technologies: project.technologies,
      stakeholders: project.stakeholders,
      external_safe_summary: project.externalSafeSummary,
      sensitivity_level: project.sensitivityLevel,
      needs_redaction_review: project.needsRedactionReview === 1,
      status: project.status,
      source_document_id: project.sourceDocumentId,
      provenance: buildLibraryItemProvenance({
        sourceDocumentId: project.sourceDocumentId,
        sourceType: project.sourceDocumentId ? "source_document" : "manual_or_generated",
      }),
      target_eligibility: buildCanonicalTargetEligibility(project.status),
      updatedAt: project.updatedAt.toISOString(),
    })),
    projectCards: projects.map((project) => ({
      id: project.id,
      title: project.title,
      context: project.context,
      problem: project.problem,
      role: project.role,
      actions: project.actions,
      results: project.results,
      metrics: project.metrics,
      technologies: project.technologies,
      stakeholders: project.stakeholders,
      public_safe_summary: project.publicSafeSummary,
      sensitivity_level: project.sensitivityLevel,
      status: project.status,
      updatedAt: project.updatedAt.toISOString(),
    })),
  };
}

function buildLibraryItemProvenance(args: {
  sourceDocumentId?: string | null;
  sourceType: "manual_or_generated" | "source_document";
}) {
  return {
    kind: args.sourceType,
    source_document_id: args.sourceDocumentId ?? null,
  };
}

function buildCanonicalTargetEligibility(status: string) {
  if (status === "rejected") {
    return {
      eligible: false,
      reason: "Rejected library items cannot be selected as enrichment targets.",
    };
  }
  return {
    eligible: true,
    reason: "Canonical library item; safe to select as an enrichment target.",
  };
}

function buildEvidenceTargetEligibility(item: typeof evidenceItems.$inferSelect) {
  if (item.status === "rejected") {
    return {
      eligible: false,
      reason: "Rejected evidence cannot be selected as an enrichment target.",
    };
  }
  if (item.needsUserConfirmation === 1) {
    return {
      eligible: true,
      reason:
        "Draft evidence can be strengthened, but resume use still requires separate review.",
    };
  }
  return {
    eligible: true,
    reason: "Canonical evidence item; safe to select as an enrichment target.",
  };
}

export async function updateProfileFacts(args: ProfileFactPatchRequest) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.workspaceId, workspace.id))
    .orderBy(desc(profiles.updatedAt))
    .limit(1);
  if (!profile) {
    return { status: "not_found" as const };
  }

  const now = new Date();
  const previousProfileJson = profile.profileJson;
  const profileJson = applyProfileFactPatch(profile.profileJson, args);
  const displayName = extractManualProfileDisplayName(profileJson) ?? profile.displayName;
  const updated = await db.transaction(async (tx) => {
    if (args.taskId) {
      const [task] = await tx
        .select({
          id: enrichmentTasks.id,
          workspaceId: enrichmentTasks.workspaceId,
          noteKind: enrichmentTasks.noteKind,
          expectedAction: enrichmentTasks.expectedAction,
          targetField: enrichmentTasks.targetField,
        })
        .from(enrichmentTasks)
        .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)))
        .limit(1);
      if (!task) return { status: "invalid" as const, reason: "task_not_found" as const };
      const expectedField = normalizeProfileFactField(task.targetField);
      if (
        task.noteKind !== "missing_profile_fact" ||
        !["add_profile_fact", "edit_profile_fact"].includes(task.expectedAction ?? "") ||
        (expectedField && expectedField !== args.field)
      ) {
        return { status: "invalid" as const, reason: "task_not_profile_fact_update" as const };
      }
    }
    const [profileRow] = await tx
      .update(profiles)
      .set({
        displayName,
        profileJson,
        updatedAt: now,
      })
      .where(and(eq(profiles.id, profile.id), eq(profiles.workspaceId, workspace.id)))
      .returning({
        id: profiles.id,
        displayName: profiles.displayName,
        profileJson: profiles.profileJson,
        updatedAt: profiles.updatedAt,
      });
    if (!profileRow) return { status: "not_found" as const };
    await tx.insert(profileFactHistory).values({
      workspaceId: workspace.id,
      profileId: profile.id,
      field: args.field,
      valueJson: getProfileFactValue(profileJson, args.field),
      previousValueJson: getProfileFactValue(previousProfileJson, args.field),
      sourceType: args.taskId ? "profile_fact_task" : "manual_edit",
      sourceTaskId: args.taskId ?? null,
      sourceDocumentId: profile.sourceDocumentId,
      updatedBy: "user",
      createdAt: now,
    });
    if (args.taskId) {
      await tx
        .update(enrichmentTasks)
        .set({
          status: "converted",
          convertedAt: now,
          resolvedAt: now,
          resolutionKind: "profile_fact_updated",
          updatedAt: now,
        })
        .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)));
    }
    return { status: "updated" as const, profile: profileRow };
  });

  if (updated.status === "invalid") {
    return updated;
  }
  if (updated.status === "not_found") {
    return { status: "not_found" as const };
  }
  return {
    status: "updated" as const,
    profile: {
      id: updated.profile.id,
      displayName: updated.profile.displayName,
      profile: updated.profile.profileJson,
      updatedAt: updated.profile.updatedAt.toISOString(),
    },
  };
}

function normalizeProfileFactField(value: string | null | undefined) {
  const normalized = value?.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  if (normalized === "certification" || normalized === "certifications" || normalized === "credentials") {
    return "certifications";
  }
  if (
    normalized === "contact" ||
    normalized === "contact_info" ||
    normalized === "email" ||
    normalized === "phone"
  ) {
    return "contact";
  }
  if (normalized === "education" || normalized === "school" || normalized === "degree") {
    return "education";
  }
  if (normalized === "location" || normalized === "personal_location") {
    return "location";
  }
  if (normalized === "skill" || normalized === "skills") {
    return "skills";
  }
  return null;
}

function getProfileFactValue(
  profile: CanonicalProfileJson,
  field: ProfileFactPatchRequest["field"],
) {
  if (field === "location") {
    return isPlainRecord(profile.contact) ? profile.contact.location ?? null : null;
  }
  if (field === "contact") return profile.contact ?? null;
  if (field === "education") return profile.education ?? [];
  if (field === "skills") return profile.skills ?? [];
  if (field === "certifications") return profile.certifications ?? [];
  return null;
}

function summarizeProfileFactSources(
  rows: Array<typeof profileFactHistory.$inferSelect>,
) {
  const summary: Record<
    string,
    {
      source_document_id: string | null;
      source_task_id: string | null;
      source_type: string;
      updated_at: string;
      updated_by: string;
    }
  > = {};
  for (const row of rows) {
    if (summary[row.field]) continue;
    summary[row.field] = {
      source_document_id: row.sourceDocumentId,
      source_task_id: row.sourceTaskId,
      source_type: row.sourceType,
      updated_at: row.createdAt.toISOString(),
      updated_by: row.updatedBy,
    };
  }
  return summary;
}

export type EvidenceDedupeCandidate = {
  primary: EvidenceDedupeItem;
  duplicate: EvidenceDedupeItem;
  score: number;
  reasons: string[];
};

export type EvidenceDedupeItem = {
  id: string;
  text: string;
  source_quote: string;
  status: string;
  allowed_usage: string[];
  sensitivity_level: string;
  evidence_type: string;
  needs_user_confirmation: boolean;
  updatedAt: string;
};

export type ProjectDedupeCandidate = {
  primary: ProjectDedupeItem;
  duplicate: ProjectDedupeItem;
  duplicateCount: number;
  duplicateProjectIds: string[];
  score: number;
  reasons: string[];
  primaryEvidenceCount: number;
  duplicateEvidenceCount: number;
};

export type ProjectDedupeItem = {
  id: string;
  title: string;
  context: string | null;
  problem: string | null;
  role: string | null;
  actions: string[];
  results: string[];
  technologies: string[];
  stakeholders: string[];
  status: string;
  updatedAt: string;
};

export type StoryTargetType = "initiative" | "portfolio_project";

export type StoryDedupeCandidate = {
  primary: StoryDedupeItem;
  duplicate: StoryDedupeItem;
  duplicateCount: number;
  duplicateStoryIds: string[];
  score: number;
  reasons: string[];
  primaryEvidenceCount: number;
  duplicateEvidenceCount: number;
};

export type StoryDedupeItem = ProjectDedupeItem & {
  storyType: StoryTargetType;
  internalTitle: string | null;
  externalSafeTitle: string | null;
  sensitivityLevel: string;
  needsRedactionReview: boolean;
};

export async function getStarStoryBank(limit = 8) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const initiativeRows = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, workspace.id), ne(initiatives.status, "rejected")))
    .orderBy(desc(initiatives.updatedAt))
    .limit(80);
  const portfolioProjectRows = await db
    .select()
    .from(portfolioProjects)
    .where(and(eq(portfolioProjects.workspaceId, workspace.id), ne(portfolioProjects.status, "rejected")))
    .orderBy(desc(portfolioProjects.updatedAt))
    .limit(80);
  const storyTargets: StarStoryTargetInput[] = [
    ...initiativeRows.map((initiative) => ({
      id: initiative.id,
      type: "initiative" as const,
      title: initiative.externalSafeTitle ?? initiative.internalTitle,
      internalTitle: initiative.internalTitle,
      context: initiative.context,
      problem: initiative.problem,
      role: initiative.role,
      actions: initiative.actions,
      results: initiative.results,
      metrics: initiative.metrics,
      technologies: initiative.technologies,
      stakeholders: initiative.stakeholders,
      publicSafeSummary: initiative.externalSafeSummary,
      sensitivityLevel: initiative.sensitivityLevel,
      status: initiative.status,
      updatedAt: initiative.updatedAt,
    })),
    ...portfolioProjectRows.map((project) => ({
      id: project.id,
      type: "portfolio_project" as const,
      title: project.externalSafeTitle ?? project.title,
      internalTitle: project.title,
      context: project.context,
      problem: project.problem,
      role: project.role,
      actions: project.actions,
      results: project.results,
      metrics: project.metrics,
      technologies: project.technologies,
      stakeholders: project.stakeholders,
      publicSafeSummary: project.externalSafeSummary,
      sensitivityLevel: project.sensitivityLevel,
      status: project.status,
      updatedAt: project.updatedAt,
    })),
  ];

  if (storyTargets.length === 0) {
    const legacyProjects = await db
      .select()
      .from(projectCards)
      .where(and(eq(projectCards.workspaceId, workspace.id), ne(projectCards.status, "rejected")))
      .orderBy(desc(projectCards.updatedAt))
      .limit(80);
    if (legacyProjects.length === 0) {
      return { status: "ready" as const, stories: [] };
    }
    const legacyEvidence = await db
      .select()
      .from(evidenceItems)
      .where(
        and(
          eq(evidenceItems.workspaceId, workspace.id),
          inArray(evidenceItems.relatedProjectId, legacyProjects.map((project) => project.id)),
        ),
      );
    return {
      status: "ready" as const,
      stories: buildStarStoryCards({
        storyTargets: legacyProjects.map((project) => ({
          id: project.id,
          type: "legacy_project" as const,
          title: project.title,
          context: project.context,
          problem: project.problem,
          role: project.role,
          actions: project.actions,
          results: project.results,
          metrics: project.metrics,
          technologies: project.technologies,
          stakeholders: project.stakeholders,
          publicSafeSummary: project.publicSafeSummary,
          sensitivityLevel: project.sensitivityLevel,
          status: project.status,
          updatedAt: project.updatedAt,
        })),
        evidenceItems: legacyEvidence,
        limit,
      }),
    };
  }

  const initiativeIds = initiativeRows.map((initiative) => initiative.id);
  const portfolioProjectIds = portfolioProjectRows.map((project) => project.id);
  const initiativeEvidence =
    initiativeIds.length > 0
      ? await db
          .select()
          .from(evidenceItems)
          .where(
            and(
              eq(evidenceItems.workspaceId, workspace.id),
              inArray(evidenceItems.relatedInitiativeId, initiativeIds),
            ),
          )
      : [];
  const portfolioEvidence =
    portfolioProjectIds.length > 0
      ? await db
          .select()
          .from(evidenceItems)
          .where(
            and(
              eq(evidenceItems.workspaceId, workspace.id),
              inArray(evidenceItems.relatedPortfolioProjectId, portfolioProjectIds),
            ),
          )
      : [];
  const linkedEvidence = [...initiativeEvidence, ...portfolioEvidence];

  if (storyTargets.length === 0) {
    return { status: "ready" as const, stories: [] };
  }

  return {
    status: "ready" as const,
    stories: buildStarStoryCards({
      storyTargets,
      evidenceItems: linkedEvidence,
      limit,
    }),
  };
}

export async function getEvidenceDedupeCandidates(limit = 8) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.status, "pending")))
    .orderBy(desc(evidenceItems.updatedAt))
    .limit(120);
  const ignoredPairs = await getIgnoredOverlapPairs({
    db,
    entityType: "evidence",
    workspaceIds: Array.from(new Set(rows.map((row) => row.workspaceId))),
  });
  const candidates: EvidenceDedupeCandidate[] = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const left = rows[leftIndex]!;
      const right = rows[rightIndex]!;
      if (left.workspaceId !== right.workspaceId) continue;
      if (ignoredPairs.has(buildOverlapPairKey(left.id, right.id))) continue;
      const match = scoreEvidenceSimilarity(left.text, right.text);
      const sameSourceQuote =
        normalizeEvidenceText(left.sourceQuote) === normalizeEvidenceText(right.sourceQuote);
      if (!sameSourceQuote && match.score < 0.86) {
        continue;
      }
      const [primary, duplicate] = chooseDedupePrimary(left, right);
      candidates.push({
        primary: toDedupeItem(primary),
        duplicate: toDedupeItem(duplicate),
        score: match.score,
        reasons: sameSourceQuote ? ["same source quote"] : match.reasons,
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const uniquePairs = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    const key = [candidate.primary.id, candidate.duplicate.id].sort().join(":");
    if (uniquePairs.has(key)) return false;
    uniquePairs.add(key);
    return true;
  });

  return {
    status: "ready" as const,
    candidates: deduped.slice(0, limit),
  };
}

export async function getProjectDedupeCandidates(limit = 8) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(projectCards)
    .where(eq(projectCards.workspaceId, workspace.id))
    .orderBy(desc(projectCards.updatedAt))
    .limit(120);
  const activeProjects = rows.filter((project) => project.status !== "rejected");
  if (activeProjects.length < 2) {
    return { status: "ready" as const, candidates: [] };
  }
  const ignoredPairs = await getIgnoredOverlapPairs({
    db,
    entityType: "project",
    workspaceIds: Array.from(new Set(activeProjects.map((project) => project.workspaceId))),
  });
  const linkedEvidence = await db
    .select({
      id: evidenceItems.id,
      relatedProjectId: evidenceItems.relatedProjectId,
    })
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, workspace.id),
        inArray(evidenceItems.relatedProjectId, activeProjects.map((project) => project.id)),
      ),
    );
  const evidenceCountByProject = new Map<string, number>();
  for (const item of linkedEvidence) {
    if (!item.relatedProjectId) continue;
    evidenceCountByProject.set(
      item.relatedProjectId,
      (evidenceCountByProject.get(item.relatedProjectId) ?? 0) + 1,
    );
  }

  const candidates: ProjectDedupeCandidate[] = [];
  for (let leftIndex = 0; leftIndex < activeProjects.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeProjects.length; rightIndex += 1) {
      const left = activeProjects[leftIndex]!;
      const right = activeProjects[rightIndex]!;
      if (left.workspaceId !== right.workspaceId) continue;
      if (ignoredPairs.has(buildOverlapPairKey(left.id, right.id))) continue;
      const match = scoreProjectSimilarity(left, right);
      if (match.score < 0.72) continue;
      const [primary, duplicate] = chooseProjectDedupePrimary(left, right);
      candidates.push({
        primary: toProjectDedupeItem(primary),
        duplicate: toProjectDedupeItem(duplicate),
        duplicateCount: 1,
        duplicateProjectIds: [duplicate.id],
        score: match.score,
        reasons: match.reasons,
        primaryEvidenceCount: evidenceCountByProject.get(primary.id) ?? 0,
        duplicateEvidenceCount: evidenceCountByProject.get(duplicate.id) ?? 0,
      });
    }
  }

  const exactTitleClusters = buildExactTitleProjectClusters(
    activeProjects,
    evidenceCountByProject,
    ignoredPairs,
  );
  const exactClusterProjectIds = new Set(
    exactTitleClusters.flatMap((candidate) => [
      candidate.primary.id,
      ...candidate.duplicateProjectIds,
    ]),
  );
  const pairCandidates = candidates.filter(
    (candidate) =>
      !exactClusterProjectIds.has(candidate.primary.id) &&
      !exactClusterProjectIds.has(candidate.duplicate.id),
  );
  const clustered = [...exactTitleClusters, ...pairCandidates].sort((left, right) => {
    if (right.duplicateCount !== left.duplicateCount) {
      return right.duplicateCount - left.duplicateCount;
    }
    return right.score - left.score;
  });
  const usedProjectIds = new Set<string>();
  const suppressed = clustered.filter((candidate) => {
    const projectIds = [candidate.primary.id, ...candidate.duplicateProjectIds];
    if (projectIds.some((projectId) => usedProjectIds.has(projectId))) {
      return false;
    }
    projectIds.forEach((projectId) => usedProjectIds.add(projectId));
    return true;
  });
  return {
    status: "ready" as const,
    candidates: suppressed.slice(0, limit),
  };
}

export async function getStoryDedupeCandidates(limit = 8) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const initiativeRows = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.workspaceId, workspace.id))
    .orderBy(desc(initiatives.updatedAt))
    .limit(120);
  const portfolioProjectRows = await db
    .select()
    .from(portfolioProjects)
    .where(eq(portfolioProjects.workspaceId, workspace.id))
    .orderBy(desc(portfolioProjects.updatedAt))
    .limit(120);
  const activeStories = [
    ...initiativeRows
      .filter((story) => story.status !== "rejected")
      .map(toInitiativeDedupeItem),
    ...portfolioProjectRows
      .filter((story) => story.status !== "rejected")
      .map(toPortfolioProjectDedupeItem),
  ];
  if (activeStories.length < 2) {
    return { status: "ready" as const, candidates: [] };
  }
  const ignoredPairsByType = new Map<StoryTargetType, Set<string>>();
  for (const storyType of ["initiative", "portfolio_project"] as const) {
    const storyIds = activeStories
      .filter((story) => story.storyType === storyType)
      .map((story) => story.id);
    if (storyIds.length < 2) {
      ignoredPairsByType.set(storyType, new Set());
      continue;
    }
    ignoredPairsByType.set(
      storyType,
      await getIgnoredOverlapPairs({
        db,
        entityType: storyType,
        workspaceIds: Array.from(
          new Set(
            activeStories
              .filter((story) => story.storyType === storyType)
              .map((story) => story.workspaceId),
          ),
        ),
      }),
    );
  }

  const evidenceCountByStory = await getEvidenceCountByStoryTarget(db, activeStories);
  const candidates: StoryDedupeCandidate[] = [];
  for (let leftIndex = 0; leftIndex < activeStories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < activeStories.length; rightIndex += 1) {
      const left = activeStories[leftIndex]!;
      const right = activeStories[rightIndex]!;
      if (left.workspaceId !== right.workspaceId) continue;
      if (left.storyType !== right.storyType) continue;
      if (
        ignoredPairsByType
          .get(left.storyType)
          ?.has(buildOverlapPairKey(left.id, right.id))
      ) {
        continue;
      }
      const match = scoreStorySimilarity(left, right);
      if (match.score < 0.72) continue;
      const [primary, duplicate] = chooseStoryDedupePrimary(left, right);
      candidates.push({
        primary: stripStoryWorkspace(primary),
        duplicate: stripStoryWorkspace(duplicate),
        duplicateCount: 1,
        duplicateStoryIds: [duplicate.id],
        score: match.score,
        reasons: match.reasons,
        primaryEvidenceCount: evidenceCountByStory.get(primary.id) ?? 0,
        duplicateEvidenceCount: evidenceCountByStory.get(duplicate.id) ?? 0,
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const usedStoryIds = new Set<string>();
  return {
    status: "ready" as const,
    candidates: candidates
      .filter((candidate) => {
        const storyIds = [candidate.primary.id, ...candidate.duplicateStoryIds];
        if (storyIds.some((storyId) => usedStoryIds.has(storyId))) return false;
        storyIds.forEach((storyId) => usedStoryIds.add(storyId));
        return true;
      })
      .slice(0, limit),
  };
}

export async function keepEvidenceOverlapSeparate(args: {
  primaryEvidenceId: string;
  duplicateEvidenceId: string;
}) {
  return keepOverlapSeparate({
    entityType: "evidence",
    leftEntityId: args.primaryEvidenceId,
    rightEntityId: args.duplicateEvidenceId,
  });
}

export async function keepProjectOverlapSeparate(args: {
  primaryProjectId: string;
  duplicateProjectIds?: string[];
  duplicateProjectId?: string;
}) {
  const duplicateIds = Array.from(
    new Set([...(args.duplicateProjectIds ?? []), ...(args.duplicateProjectId ? [args.duplicateProjectId] : [])]),
  );
  if (duplicateIds.length === 0) {
    return { status: "invalid" as const, reason: "missing_duplicate_project" as const };
  }
  const results = [];
  for (const duplicateId of duplicateIds) {
    const result = await keepOverlapSeparate({
      entityType: "project",
      leftEntityId: args.primaryProjectId,
      rightEntityId: duplicateId,
    });
    if (result.status !== "saved") return result;
    results.push(result);
  }
  return {
    status: "saved" as const,
    entityType: "project" as const,
    ignoredPairCount: results.length,
  };
}

export async function keepStoryOverlapSeparate(args: {
  storyType: StoryTargetType;
  primaryStoryId: string;
  duplicateStoryIds?: string[];
  duplicateStoryId?: string;
}) {
  const duplicateIds = Array.from(
    new Set([...(args.duplicateStoryIds ?? []), ...(args.duplicateStoryId ? [args.duplicateStoryId] : [])]),
  );
  if (duplicateIds.length === 0) {
    return { status: "invalid" as const, reason: "missing_duplicate_story" as const };
  }
  const results = [];
  for (const duplicateId of duplicateIds) {
    const result = await keepOverlapSeparate({
      entityType: args.storyType,
      leftEntityId: args.primaryStoryId,
      rightEntityId: duplicateId,
    });
    if (result.status !== "saved") return result;
    results.push(result);
  }
  return {
    status: "saved" as const,
    entityType: args.storyType,
    ignoredPairCount: results.length,
  };
}

export async function mergeStoryTargets(args: {
  storyType: StoryTargetType;
  primaryStoryId: string;
  duplicateStoryIds: string[];
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const duplicateIds = Array.from(new Set(args.duplicateStoryIds));
  if (duplicateIds.length === 0) {
    return { status: "invalid" as const, reason: "missing_duplicate_story" as const };
  }
  if (duplicateIds.includes(args.primaryStoryId)) {
    return { status: "invalid" as const, reason: "same_story_id" as const };
  }
  if (args.storyType !== "initiative") {
    return { status: "invalid" as const, reason: "unsupported_story_type" as const };
  }

  const mergeResult = await getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const rows = await tx
      .select()
      .from(initiatives)
      .where(
        and(
          eq(initiatives.workspaceId, workspace.id),
          inArray(initiatives.id, [args.primaryStoryId, ...duplicateIds]),
        ),
      );
    const primary = rows.find((story) => story.id === args.primaryStoryId);
    const duplicates = duplicateIds
      .map((id) => rows.find((story) => story.id === id))
      .filter((story): story is typeof initiatives.$inferSelect => Boolean(story));
    if (!primary || duplicates.length !== duplicateIds.length) {
      return { status: "not_found" as const };
    }
    if (duplicates.some((duplicate) => duplicate.workspaceId !== primary.workspaceId)) {
      return { status: "invalid" as const, reason: "cross_workspace_story_merge" as const };
    }
    if (primary.status === "rejected" || duplicates.some((duplicate) => duplicate.status === "rejected")) {
      return { status: "invalid" as const, reason: "rejected_story" as const };
    }
    const now = new Date();
    const mergedMetrics = duplicates.reduce(
      (metrics, duplicate) => mergeJsonArrays(metrics, duplicate.metrics),
      primary.metrics,
    );
    await tx
      .update(initiatives)
      .set({
        workExperienceId:
          primary.workExperienceId ??
          duplicates.find((duplicate) => duplicate.workExperienceId)?.workExperienceId ??
          null,
        sourceDocumentId:
          primary.sourceDocumentId ??
          duplicates.find((duplicate) => duplicate.sourceDocumentId)?.sourceDocumentId ??
          null,
        externalSafeTitle:
          primary.externalSafeTitle ??
          firstInitiativeValue(duplicates, "externalSafeTitle"),
        context: mergeNullableText(primary.context, duplicates.map((duplicate) => duplicate.context)),
        problem: mergeNullableText(primary.problem, duplicates.map((duplicate) => duplicate.problem)),
        role: mergeNullableText(primary.role, duplicates.map((duplicate) => duplicate.role)),
        actions: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.actions),
          primary.actions,
        ),
        results: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.results),
          primary.results,
        ),
        metrics: mergedMetrics,
        technologies: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.technologies),
          primary.technologies,
        ),
        stakeholders: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.stakeholders),
          primary.stakeholders,
        ),
        externalSafeSummary:
          primary.externalSafeSummary ??
          firstInitiativeValue(duplicates, "externalSafeSummary"),
        sensitivityLevel: maxSensitivity([
          primary.sensitivityLevel,
          ...duplicates.map((duplicate) => duplicate.sensitivityLevel),
        ]),
        needsRedactionReview:
          primary.needsRedactionReview === 1 ||
          duplicates.some((duplicate) => duplicate.needsRedactionReview === 1)
            ? 1
            : 0,
        status:
          primary.status === "approved" || duplicates.some((duplicate) => duplicate.status === "approved")
            ? "approved"
            : primary.status,
        updatedAt: now,
      })
      .where(and(eq(initiatives.workspaceId, workspace.id), eq(initiatives.id, primary.id)));

    const movedEvidence = await tx
      .update(evidenceItems)
      .set({
        relatedInitiativeId: primary.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(evidenceItems.workspaceId, workspace.id),
          inArray(evidenceItems.relatedInitiativeId, duplicateIds),
        ),
      )
      .returning({ id: evidenceItems.id });

    const primaryEvidence = await tx
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(
        and(
          eq(evidenceItems.workspaceId, workspace.id),
          eq(evidenceItems.relatedInitiativeId, primary.id),
        ),
      );

    await tx
      .update(initiatives)
      .set({
        status: "rejected",
        updatedAt: now,
      })
      .where(and(eq(initiatives.workspaceId, workspace.id), inArray(initiatives.id, duplicateIds)));

    return {
      status: "merged" as const,
      storyType: "initiative" as const,
      primaryStoryId: primary.id,
      duplicateStoryId: duplicateIds[0],
      duplicateStoryIds: duplicateIds,
      duplicateStoryCount: duplicateIds.length,
      impactedEvidenceIds: Array.from(
        new Set([...movedEvidence.map((item) => item.id), ...primaryEvidence.map((item) => item.id)]),
      ),
      movedEvidenceCount: movedEvidence.length,
      mergedMetricCount: mergedMetrics.length,
    };
  });

  if (mergeResult.status === "merged" && mergeResult.impactedEvidenceIds.length > 0) {
    const staleResult = await markClaimsStaleForEvidenceIds(mergeResult.impactedEvidenceIds).catch(() => ({
      status: "skipped" as const,
      reason: "stale_mark_failed" as const,
    }));
    return {
      ...mergeResult,
      staleClaimCount: staleResult.status === "saved" ? staleResult.staleCount : 0,
    };
  }
  return mergeResult;
}

export async function mergeEvidenceItems(args: {
  primaryEvidenceId: string;
  duplicateEvidenceId: string;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  if (args.primaryEvidenceId === args.duplicateEvidenceId) {
    return { status: "invalid" as const, reason: "same_evidence_id" as const };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const rows = await tx
      .select()
      .from(evidenceItems)
      .where(
        and(
          eq(evidenceItems.workspaceId, workspace.id),
          inArray(evidenceItems.id, [args.primaryEvidenceId, args.duplicateEvidenceId]),
        ),
      );
    const primary = rows.find((item) => item.id === args.primaryEvidenceId);
    const duplicate = rows.find((item) => item.id === args.duplicateEvidenceId);
    if (!primary || !duplicate) return { status: "not_found" as const };
    if (primary.status === "rejected" || duplicate.status === "rejected") {
      return { status: "invalid" as const, reason: "rejected_evidence" as const };
    }

    const now = new Date();
    const mergedAllowedUsage = Array.from(
      new Set([...primary.allowedUsage, ...duplicate.allowedUsage]),
    );
    const mergedMetrics = mergeJsonArrays(primary.metrics, duplicate.metrics);
    const mergedSummary =
      primary.publicSafeSummary ??
      duplicate.publicSafeSummary ??
      null;
    await tx
      .update(evidenceItems)
      .set({
        allowedUsage: mergedAllowedUsage,
        metrics: mergedMetrics,
        publicSafeSummary: mergedSummary,
        needsUserConfirmation:
          primary.needsUserConfirmation || duplicate.needsUserConfirmation ? 1 : 0,
        updatedAt: now,
      })
      .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.id, primary.id)));
    await tx
      .update(evidenceItems)
      .set({
        status: "rejected",
        updatedAt: now,
      })
      .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.id, duplicate.id)));

    await markClaimsStaleForEvidenceIds([primary.id, duplicate.id]);
    return {
      status: "merged" as const,
      primaryEvidenceId: primary.id,
      duplicateEvidenceId: duplicate.id,
      mergedAllowedUsage,
    };
  });
}

export async function mergeProjectCards(args: {
  primaryProjectId: string;
  duplicateProjectId?: string;
  duplicateProjectIds?: string[];
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const duplicateIds = Array.from(
    new Set([...(args.duplicateProjectIds ?? []), ...(args.duplicateProjectId ? [args.duplicateProjectId] : [])]),
  );
  if (duplicateIds.length === 0) {
    return { status: "invalid" as const, reason: "missing_duplicate_project" as const };
  }
  if (duplicateIds.includes(args.primaryProjectId)) {
    return { status: "invalid" as const, reason: "same_project_id" as const };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const rows = await tx
      .select()
      .from(projectCards)
      .where(
        and(
          eq(projectCards.workspaceId, workspace.id),
          inArray(projectCards.id, [args.primaryProjectId, ...duplicateIds]),
        ),
      );
    const primary = rows.find((project) => project.id === args.primaryProjectId);
    const duplicates = duplicateIds
      .map((id) => rows.find((project) => project.id === id))
      .filter((project): project is typeof projectCards.$inferSelect => Boolean(project));
    if (!primary || duplicates.length !== duplicateIds.length) return { status: "not_found" as const };
    if (duplicates.some((duplicate) => duplicate.workspaceId !== primary.workspaceId)) {
      return { status: "invalid" as const, reason: "cross_workspace_project_merge" as const };
    }
    if (primary.status === "rejected" || duplicates.some((duplicate) => duplicate.status === "rejected")) {
      return { status: "invalid" as const, reason: "rejected_project" as const };
    }

    const now = new Date();
    const mergedMetrics = duplicates.reduce(
      (metrics, duplicate) => mergeJsonArrays(metrics, duplicate.metrics),
      primary.metrics,
    );
    await tx
      .update(projectCards)
      .set({
        context: primary.context ?? firstProjectValue(duplicates, "context"),
        problem: primary.problem ?? firstProjectValue(duplicates, "problem"),
        role: primary.role ?? firstProjectValue(duplicates, "role"),
        actions: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.actions),
          primary.actions,
        ),
        results: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.results),
          primary.results,
        ),
        metrics: mergedMetrics,
        technologies: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.technologies),
          primary.technologies,
        ),
        stakeholders: duplicates.reduce(
          (items, duplicate) => mergeStringArrays(items, duplicate.stakeholders),
          primary.stakeholders,
        ),
        publicSafeSummary: primary.publicSafeSummary ?? firstProjectValue(duplicates, "publicSafeSummary"),
        status:
          primary.status === "approved" || duplicates.some((duplicate) => duplicate.status === "approved")
            ? "approved"
            : primary.status,
        sensitivityLevel:
          primary.sensitivityLevel === "sensitive" ||
          duplicates.some((duplicate) => duplicate.sensitivityLevel === "sensitive")
            ? "sensitive"
            : primary.sensitivityLevel === "private" ||
                duplicates.some((duplicate) => duplicate.sensitivityLevel === "private")
              ? "private"
              : "public_safe",
        updatedAt: now,
      })
      .where(and(eq(projectCards.workspaceId, workspace.id), eq(projectCards.id, primary.id)));

    const movedEvidence = await tx
      .update(evidenceItems)
      .set({
        relatedProjectId: primary.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(evidenceItems.workspaceId, workspace.id),
          inArray(evidenceItems.relatedProjectId, duplicateIds),
        ),
      )
      .returning({ id: evidenceItems.id });

    await tx
      .update(projectCards)
      .set({
        status: "rejected",
        updatedAt: now,
      })
      .where(and(eq(projectCards.workspaceId, workspace.id), inArray(projectCards.id, duplicateIds)));

    if (movedEvidence.length > 0) {
      await markClaimsStaleForEvidenceIds(movedEvidence.map((item) => item.id));
    }

    return {
      status: "merged" as const,
      primaryProjectId: primary.id,
      duplicateProjectId: duplicateIds[0],
      duplicateProjectIds: duplicateIds,
      duplicateProjectCount: duplicateIds.length,
      movedEvidenceCount: movedEvidence.length,
      mergedMetricCount: mergedMetrics.length,
    };
  });
}

export async function updateProjectCard(args: {
  projectId: string;
  action: "approve" | "reject" | "edit";
  title?: string;
  context?: string | null;
  problem?: string | null;
  role?: string | null;
  publicSafeSummary?: string | null;
  sensitivityLevel?: SensitivityLevel;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const patch: Partial<typeof projectCards.$inferInsert> = {
    updatedAt: new Date(),
  };
  let redactionReport = null;
  if (args.action === "approve") {
    patch.status = "approved";
  } else if (args.action === "reject") {
    patch.status = "rejected";
  } else {
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.context !== undefined) patch.context = args.context?.trim() || null;
    if (args.problem !== undefined) patch.problem = args.problem?.trim() || null;
    if (args.role !== undefined) patch.role = args.role?.trim() || null;
    if (args.publicSafeSummary !== undefined) {
      patch.publicSafeSummary = args.publicSafeSummary?.trim() || null;
      if (patch.publicSafeSummary && !isPublicSafeText(patch.publicSafeSummary)) {
        return {
          status: "invalid" as const,
          reason: "public_safe_summary_contains_blocked_terms" as const,
          redactionReport: buildRedactionReport({
            text: [args.title, args.context, args.problem, args.role].filter(Boolean).join(" "),
            fallbackSummary: patch.publicSafeSummary,
          }),
        };
      }
    }
    if (args.sensitivityLevel !== undefined) {
      patch.sensitivityLevel = args.sensitivityLevel;
    }
    redactionReport = buildRedactionReport({
      text: [args.title, args.context, args.problem, args.role].filter(Boolean).join(" "),
      fallbackSummary: patch.publicSafeSummary,
    });
    if (patch.publicSafeSummary && !redactionReport.hasBlockedTerms) {
      patch.sensitivityLevel = args.sensitivityLevel ?? "public_safe";
    }
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [project] = await db
    .update(projectCards)
    .set(patch)
    .where(and(eq(projectCards.workspaceId, workspace.id), eq(projectCards.id, args.projectId)))
    .returning({
      id: projectCards.id,
      title: projectCards.title,
      context: projectCards.context,
      problem: projectCards.problem,
      role: projectCards.role,
      publicSafeSummary: projectCards.publicSafeSummary,
      sensitivityLevel: projectCards.sensitivityLevel,
      status: projectCards.status,
    });

  return project
    ? ({ status: "saved" as const, projectCard: project, redactionReport })
    : ({ status: "not_found" as const });
}

export async function approveProjectEvidenceForResume(projectId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [project] = await db
    .select({ id: projectCards.id })
    .from(projectCards)
    .where(and(eq(projectCards.workspaceId, workspace.id), eq(projectCards.id, projectId)))
    .limit(1);
  if (!project) return { status: "not_found" as const };
  const linkedEvidence = await db
    .select()
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.relatedProjectId, projectId)));
  const eligibleEvidence = linkedEvidence.filter(
    (item) =>
      item.evidenceType !== "inferred" &&
      !item.allowedUsage.includes("internal_only") &&
      hasResumeSafeDisclosure({
        sensitivityLevel: item.sensitivityLevel,
        publicSafeSummary: item.publicSafeSummary,
      }),
  );
  if (eligibleEvidence.length === 0) {
    return {
      status: "saved" as const,
      projectId,
      evidenceCount: 0,
      skippedCount: linkedEvidence.length,
    };
  }

  const updated = await db
    .update(evidenceItems)
    .set({
      status: "approved",
      needsUserConfirmation: 0,
      allowedUsage: ["resume", "interview"],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(evidenceItems.workspaceId, workspace.id),
        inArray(evidenceItems.id, eligibleEvidence.map((item) => item.id)),
      ),
    )
    .returning({ id: evidenceItems.id });

  return {
    status: "saved" as const,
    projectId,
    evidenceCount: updated.length,
    skippedCount: linkedEvidence.length - updated.length,
  };
}

export async function assignInitiativeToWorkExperience(args: {
  initiativeId: string;
  workExperienceId: string | null;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [initiative] = await db
    .select({
      id: initiatives.id,
      status: initiatives.status,
      workspaceId: initiatives.workspaceId,
    })
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, workspace.id), eq(initiatives.id, args.initiativeId)))
    .limit(1);
  if (!initiative) return { status: "not_found" as const };
  if (initiative.status === "rejected") {
    return { status: "invalid" as const, reason: "initiative_rejected" as const };
  }

  if (args.workExperienceId) {
    const [experience] = await db
      .select({
        id: workExperiences.id,
        status: workExperiences.status,
        workspaceId: workExperiences.workspaceId,
      })
      .from(workExperiences)
      .where(
        and(
          eq(workExperiences.workspaceId, workspace.id),
          eq(workExperiences.id, args.workExperienceId),
        ),
      )
      .limit(1);
    if (!experience) {
      return { status: "invalid" as const, reason: "work_experience_not_found" as const };
    }
    if (experience.status === "rejected") {
      return { status: "invalid" as const, reason: "work_experience_rejected" as const };
    }
    if (experience.workspaceId !== initiative.workspaceId) {
      return { status: "invalid" as const, reason: "cross_workspace_work_experience_link" as const };
    }
  }

  const [updated] = await db
    .update(initiatives)
    .set({
      workExperienceId: args.workExperienceId,
      updatedAt: new Date(),
    })
    .where(and(eq(initiatives.workspaceId, workspace.id), eq(initiatives.id, args.initiativeId)))
    .returning({
      id: initiatives.id,
      workExperienceId: initiatives.workExperienceId,
    });

  return updated
    ? ({ status: "saved" as const, initiative: updated })
    : ({ status: "not_found" as const });
}

export async function createWorkExperienceAndAssignInitiative(args: {
  initiativeId: string;
  employer: string;
  roleTitle: string;
  team?: string | null;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  summary?: string | null;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const [initiative] = await tx
      .select({
        id: initiatives.id,
        status: initiatives.status,
        workspaceId: initiatives.workspaceId,
      })
      .from(initiatives)
      .where(and(eq(initiatives.workspaceId, workspace.id), eq(initiatives.id, args.initiativeId)))
      .limit(1);
    if (!initiative) return { status: "not_found" as const };
    if (initiative.status === "rejected") {
      return { status: "invalid" as const, reason: "initiative_rejected" as const };
    }

    const now = new Date();
    const [experience] = await tx
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: args.employer.trim(),
        roleTitle: args.roleTitle.trim(),
        team: args.team?.trim() || null,
        location: args.location?.trim() || null,
        startDate: args.startDate?.trim() || null,
        endDate: args.endDate?.trim() || null,
        summary: args.summary?.trim() || null,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: workExperiences.id,
        employer: workExperiences.employer,
        roleTitle: workExperiences.roleTitle,
        status: workExperiences.status,
      });
    if (!experience) {
      return { status: "invalid" as const, reason: "work_experience_create_failed" as const };
    }

    const [updated] = await tx
      .update(initiatives)
      .set({
        workExperienceId: experience.id,
        updatedAt: now,
      })
      .where(and(eq(initiatives.workspaceId, workspace.id), eq(initiatives.id, args.initiativeId)))
      .returning({
        id: initiatives.id,
        workExperienceId: initiatives.workExperienceId,
      });

    return updated
      ? ({ status: "saved" as const, initiative: updated, workExperience: experience })
      : ({ status: "not_found" as const });
  });
}

export async function updateWorkExperienceFields(args: {
  workExperienceId: string;
  location?: string | null;
  team?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  summary?: string | null;
  taskId?: string | null;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const submittedFields = getSubmittedWorkExperienceFields(args);
    if (submittedFields.length === 0) {
      return { status: "invalid" as const, reason: "missing_work_experience_field" as const };
    }
    const [current] = await tx
      .select({
        id: workExperiences.id,
        status: workExperiences.status,
        workspaceId: workExperiences.workspaceId,
      })
      .from(workExperiences)
      .where(
        and(
          eq(workExperiences.workspaceId, workspace.id),
          eq(workExperiences.id, args.workExperienceId),
        ),
      )
      .limit(1);
    if (!current) return { status: "not_found" as const };
    if (current.status === "rejected") {
      return { status: "invalid" as const, reason: "work_experience_rejected" as const };
    }

    if (args.taskId) {
      if (submittedFields.length > 1) {
        return { status: "invalid" as const, reason: "multiple_work_experience_fields" as const };
      }
      const [task] = await tx
        .select({
          id: enrichmentTasks.id,
          noteKind: enrichmentTasks.noteKind,
          expectedAction: enrichmentTasks.expectedAction,
          targetField: enrichmentTasks.targetField,
          workExperienceId: enrichmentTasks.workExperienceId,
        })
        .from(enrichmentTasks)
        .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)))
        .limit(1);
      if (!task) return { status: "not_found" as const };
      if (
        task.noteKind !== "missing_role_field" ||
        task.expectedAction !== "edit_role_field"
      ) {
        return { status: "invalid" as const, reason: "task_not_role_field_update" as const };
      }
      const expectedField = normalizeWorkExperienceTargetField(task.targetField);
      const submittedField = submittedFields[0];
      if (!expectedField || expectedField !== submittedField) {
        return { status: "invalid" as const, reason: "task_field_mismatch" as const };
      }
      const targetRows = await tx
        .select({
          targetId: enrichmentTaskTargets.targetId,
          targetRole: enrichmentTaskTargets.targetRole,
        })
        .from(enrichmentTaskTargets)
        .where(
          and(
            eq(enrichmentTaskTargets.workspaceId, workspace.id),
            eq(enrichmentTaskTargets.taskId, args.taskId),
            eq(enrichmentTaskTargets.targetKind, "work_experience"),
          ),
        );
      const anchoredWorkExperienceId =
        task.workExperienceId ??
        targetRows.find((target) => target.targetRole === "primary")?.targetId ??
        targetRows.find((target) => target.targetRole === "parent")?.targetId ??
        null;
      if (anchoredWorkExperienceId && anchoredWorkExperienceId !== args.workExperienceId) {
        return { status: "invalid" as const, reason: "task_target_mismatch" as const };
      }
    }

    const now = new Date();
    const patch: Partial<typeof workExperiences.$inferInsert> = { updatedAt: now };
    if (args.location !== undefined) patch.location = args.location?.trim() || null;
    if (args.team !== undefined) patch.team = args.team?.trim() || null;
    if (args.startDate !== undefined) patch.startDate = args.startDate?.trim() || null;
    if (args.endDate !== undefined) patch.endDate = args.endDate?.trim() || null;
    if (args.summary !== undefined) patch.summary = args.summary?.trim() || null;

    const [updated] = await tx
      .update(workExperiences)
      .set(patch)
      .where(
        and(
          eq(workExperiences.workspaceId, workspace.id),
          eq(workExperiences.id, args.workExperienceId),
        ),
      )
      .returning({
        id: workExperiences.id,
        employer: workExperiences.employer,
        roleTitle: workExperiences.roleTitle,
        location: workExperiences.location,
        team: workExperiences.team,
        startDate: workExperiences.startDate,
        endDate: workExperiences.endDate,
        summary: workExperiences.summary,
        updatedAt: workExperiences.updatedAt,
      });
    if (!updated) return { status: "not_found" as const };

    if (args.taskId) {
      await tx
        .update(enrichmentTasks)
        .set({
          status: "converted",
          convertedAt: now,
          resolvedAt: now,
          resolutionKind: "role_field_updated",
          workExperienceId: args.workExperienceId,
          targetScope: "role_context",
          expectedOutcome: "update_role",
          updatedAt: now,
        })
        .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)));
    }

    return { status: "saved" as const, workExperience: updated };
  });
}

function getSubmittedWorkExperienceFields(args: {
  location?: string | null;
  team?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  summary?: string | null;
}) {
  const fields: Array<"location" | "team" | "start_date" | "end_date" | "summary"> = [];
  if (args.location !== undefined) fields.push("location");
  if (args.team !== undefined) fields.push("team");
  if (args.startDate !== undefined) fields.push("start_date");
  if (args.endDate !== undefined) fields.push("end_date");
  if (args.summary !== undefined) fields.push("summary");
  return fields;
}

function normalizeWorkExperienceTargetField(value: string | null | undefined) {
  if (value === "location" || value === "team" || value === "summary") return value;
  if (value === "start_date" || value === "startDate") return "start_date";
  if (value === "end_date" || value === "endDate") return "end_date";
  return null;
}

export async function markClaimsStaleForEvidenceIds(evidenceIds: string[]) {
  if (!hasDatabaseUrl() || evidenceIds.length === 0) {
    return {
      status: "skipped" as const,
      reason: "missing_database_url_or_ids" as const,
    };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(generatedClaims)
    .where(eq(generatedClaims.workspaceId, workspace.id));
  const impacted = rows.filter((claim) =>
    claim.evidenceIds.some((id) => evidenceIds.includes(id)),
  );
  if (impacted.length === 0) {
    return { status: "saved" as const, staleCount: 0 };
  }
  await db
    .update(generatedClaims)
    .set({
      claimStatus: "stale",
      staleReason: "Linked evidence was edited or reclassified.",
      lastValidatedAt: null,
    })
    .where(
      and(
        eq(generatedClaims.workspaceId, workspace.id),
        inArray(generatedClaims.id, impacted.map((claim) => claim.id)),
      ),
    );
  return { status: "saved" as const, staleCount: impacted.length };
}

export async function updateEvidenceItem(args: {
  evidenceId: string;
  action: "approve" | "approve_for_resume" | "reject" | "edit";
  text?: string;
  publicSafeSummary?: string | null;
  allowedUsage?: AllowedUsage[];
  sensitivityLevel?: SensitivityLevel;
  relatedProjectId?: string | null;
  relatedWorkExperienceId?: string | null;
  relatedInitiativeId?: string | null;
  relatedPortfolioProjectId?: string | null;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const patch: Partial<typeof evidenceItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  let redactionReport = null;
  if (args.action === "edit" && args.relatedProjectId) {
    const validation = await validateEvidenceProjectLink({
      db,
      evidenceId: args.evidenceId,
      relatedProjectId: args.relatedProjectId,
      workspaceId: workspace.id,
    });
    if (validation.status !== "valid") return validation;
  }
  if (args.action === "edit") {
    const targetValidation = await validateEvidenceStoryLinks({
      db,
      evidenceId: args.evidenceId,
      workspaceId: workspace.id,
      relatedWorkExperienceId: args.relatedWorkExperienceId,
      relatedInitiativeId: args.relatedInitiativeId,
      relatedPortfolioProjectId: args.relatedPortfolioProjectId,
    });
    if (targetValidation.status !== "valid") return targetValidation;
  }
  if (args.action === "approve") {
    patch.status = "approved";
    patch.needsUserConfirmation = 0;
  } else if (args.action === "approve_for_resume") {
    const [existing] = await db
      .select()
      .from(evidenceItems)
      .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.id, args.evidenceId)))
      .limit(1);
    if (!existing) return { status: "not_found" as const };
    const requestedUsage = Array.from(
      new Set([...(args.allowedUsage ?? existing.allowedUsage), "resume"]),
    );
    if (
      !hasResumeSafeDisclosure({
        text: existing.text,
        sensitivityLevel: existing.sensitivityLevel,
        publicSafeSummary: existing.publicSafeSummary,
      })
    ) {
      return {
        status: "invalid" as const,
        reason: "resume_evidence_requires_public_safe_summary" as const,
        redactionReport: buildRedactionReport({
          text: existing.sourceQuote,
          fallbackSummary: existing.publicSafeSummary,
        }),
      };
    }
    if (requestedUsage.includes("internal_only") || existing.allowedUsage.includes("internal_only")) {
      return {
        status: "invalid" as const,
        reason: "internal_only_evidence_requires_external_safe_edit" as const,
      };
    }
    patch.status = "approved";
    patch.allowedUsage = requestedUsage.filter(
      (usage): usage is AllowedUsage =>
        usage !== "internal_only" && AllowedUsage.options.includes(usage as AllowedUsage),
    );
    patch.needsUserConfirmation = 0;
  } else if (args.action === "reject") {
    patch.status = "rejected";
  } else {
    if (args.text != null) patch.text = args.text.trim();
    if (args.publicSafeSummary !== undefined) {
      patch.publicSafeSummary = args.publicSafeSummary?.trim() || null;
      if (patch.publicSafeSummary && !isPublicSafeText(patch.publicSafeSummary)) {
        return {
          status: "invalid" as const,
          reason: "public_safe_summary_contains_blocked_terms" as const,
          redactionReport: buildRedactionReport({
            text: args.text ?? "",
            fallbackSummary: patch.publicSafeSummary,
          }),
        };
      }
    }
    if (args.allowedUsage !== undefined) {
      patch.allowedUsage = Array.from(new Set(args.allowedUsage));
    }
    if (args.sensitivityLevel !== undefined) {
      patch.sensitivityLevel = args.sensitivityLevel;
    }
    redactionReport = buildRedactionReport({
      text: args.text ?? "",
      fallbackSummary: patch.publicSafeSummary,
    });
    if (patch.publicSafeSummary && !redactionReport.hasBlockedTerms) {
      patch.sensitivityLevel = args.sensitivityLevel ?? "public_safe";
    }
    const storyTargetWasProvided =
      args.relatedWorkExperienceId !== undefined ||
      args.relatedInitiativeId !== undefined ||
      args.relatedPortfolioProjectId !== undefined;
    if (storyTargetWasProvided) {
      patch.relatedWorkExperienceId = args.relatedWorkExperienceId ?? null;
      patch.relatedInitiativeId = args.relatedInitiativeId ?? null;
      patch.relatedPortfolioProjectId = args.relatedPortfolioProjectId ?? null;
      patch.relatedProjectId = args.relatedProjectId ?? null;
    } else if (args.relatedProjectId !== undefined) {
      patch.relatedProjectId = args.relatedProjectId;
    }
    patch.needsUserConfirmation = 1;
  }

  const [item] = await db
    .update(evidenceItems)
    .set(patch)
    .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.id, args.evidenceId)))
    .returning({
      id: evidenceItems.id,
      text: evidenceItems.text,
      status: evidenceItems.status,
      needsUserConfirmation: evidenceItems.needsUserConfirmation,
      publicSafeSummary: evidenceItems.publicSafeSummary,
      allowedUsage: evidenceItems.allowedUsage,
      sensitivityLevel: evidenceItems.sensitivityLevel,
      relatedProjectId: evidenceItems.relatedProjectId,
      relatedWorkExperienceId: evidenceItems.relatedWorkExperienceId,
      relatedInitiativeId: evidenceItems.relatedInitiativeId,
      relatedPortfolioProjectId: evidenceItems.relatedPortfolioProjectId,
    });

  if (!item) return { status: "not_found" as const };
  if (args.action === "edit" || args.action === "reject") {
    await markClaimsStaleForEvidenceIds([args.evidenceId]);
  }

  return {
    status: "saved" as const,
    evidenceItem: {
      ...item,
      needsUserConfirmation: item.needsUserConfirmation === 1,
    },
    redactionReport,
  };
}

export async function getResumeTailoringContext(
  job?: ResumeRetrievalJobContext | null,
) {
  if (!hasDatabaseUrl()) {
    return {
      profile: null,
      evidenceItems: [],
    };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.workspaceId, workspace.id))
    .orderBy(desc(profiles.updatedAt))
    .limit(1);
  const evidence = await retrieveResumeEvidenceForJob(job, { limit: 12 });

  return {
    profile: profile
      ? {
          id: profile.id,
          displayName: profile.displayName,
          profile: profile.profileJson,
          updatedAt: profile.updatedAt.toISOString(),
        }
      : null,
    evidenceItems: evidence,
  };
}

async function getIgnoredOverlapPairs(args: {
  db: ReturnType<typeof getDb>;
  entityType: "evidence" | "project" | StoryTargetType;
  workspaceIds: string[];
}) {
  if (args.workspaceIds.length === 0) return new Set<string>();
  const decisions = await args.db
    .select({
      leftEntityId: overlapReviewDecisions.leftEntityId,
      rightEntityId: overlapReviewDecisions.rightEntityId,
    })
    .from(overlapReviewDecisions)
    .where(
      and(
        eq(overlapReviewDecisions.entityType, args.entityType),
        eq(overlapReviewDecisions.decision, "keep_separate"),
        inArray(overlapReviewDecisions.workspaceId, args.workspaceIds),
      ),
    );
  return new Set(
    decisions.map((decision) =>
      buildOverlapPairKey(decision.leftEntityId, decision.rightEntityId),
    ),
  );
}

async function keepOverlapSeparate(args: {
  entityType: "evidence" | "project" | StoryTargetType;
  leftEntityId: string;
  rightEntityId: string;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  if (args.leftEntityId === args.rightEntityId) {
    return { status: "invalid" as const, reason: "same_entity_id" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const table = getOverlapEntityTable(args.entityType);
  const rows = await db
    .select({
      id: table.id,
      workspaceId: table.workspaceId,
      status: table.status,
    })
    .from(table)
    .where(
      and(
        eq(table.workspaceId, workspace.id),
        inArray(table.id, [args.leftEntityId, args.rightEntityId]),
      ),
    );
  const left = rows.find((row) => row.id === args.leftEntityId);
  const right = rows.find((row) => row.id === args.rightEntityId);
  if (!left || !right) return { status: "not_found" as const };
  if (left.workspaceId !== right.workspaceId) {
    return { status: "invalid" as const, reason: "cross_workspace_overlap" as const };
  }
  if (left.status === "rejected" || right.status === "rejected") {
    return { status: "invalid" as const, reason: "rejected_overlap_entity" as const };
  }

  const [leftEntityId, rightEntityId] = sortOverlapPair(args.leftEntityId, args.rightEntityId);
  const now = new Date();
  await db
    .insert(overlapReviewDecisions)
    .values({
      workspaceId: left.workspaceId,
      entityType: args.entityType,
      leftEntityId,
      rightEntityId,
      decision: "keep_separate",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        overlapReviewDecisions.workspaceId,
        overlapReviewDecisions.entityType,
        overlapReviewDecisions.leftEntityId,
        overlapReviewDecisions.rightEntityId,
      ],
      set: {
        decision: "keep_separate",
        updatedAt: now,
      },
    });
  return {
    status: "saved" as const,
    entityType: args.entityType,
    leftEntityId,
    rightEntityId,
  };
}

function getOverlapEntityTable(entityType: "evidence" | "project" | StoryTargetType) {
  if (entityType === "evidence") return evidenceItems;
  if (entityType === "initiative") return initiatives;
  if (entityType === "portfolio_project") return portfolioProjects;
  return projectCards;
}

function sortOverlapPair(leftId: string, rightId: string) {
  return [leftId, rightId].sort() as [string, string];
}

function buildOverlapPairKey(leftId: string, rightId: string) {
  return sortOverlapPair(leftId, rightId).join(":");
}

async function validateEvidenceProjectLink(args: {
  db: ReturnType<typeof getDb>;
  evidenceId: string;
  relatedProjectId: string;
  workspaceId: string;
}) {
  const [evidence] = await args.db
    .select({
      id: evidenceItems.id,
      workspaceId: evidenceItems.workspaceId,
    })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, args.workspaceId), eq(evidenceItems.id, args.evidenceId)))
    .limit(1);
  if (!evidence) return { status: "not_found" as const };

  const [project] = await args.db
    .select({
      id: projectCards.id,
      workspaceId: projectCards.workspaceId,
      status: projectCards.status,
    })
    .from(projectCards)
    .where(and(eq(projectCards.workspaceId, args.workspaceId), eq(projectCards.id, args.relatedProjectId)))
    .limit(1);
  if (!project) {
    return { status: "invalid" as const, reason: "related_project_not_found" as const };
  }
  if (project.status === "rejected") {
    return { status: "invalid" as const, reason: "related_project_rejected" as const };
  }
  if (project.workspaceId !== evidence.workspaceId) {
    return { status: "invalid" as const, reason: "cross_workspace_project_link" as const };
  }
  return { status: "valid" as const };
}

async function validateEvidenceStoryLinks(args: {
  db: ReturnType<typeof getDb>;
  evidenceId: string;
  workspaceId: string;
  relatedWorkExperienceId?: string | null;
  relatedInitiativeId?: string | null;
  relatedPortfolioProjectId?: string | null;
}) {
  const targetIds = [
    args.relatedWorkExperienceId,
    args.relatedInitiativeId,
    args.relatedPortfolioProjectId,
  ].filter(Boolean);
  if (targetIds.length === 0) return { status: "valid" as const };

  const [evidence] = await args.db
    .select({
      id: evidenceItems.id,
      workspaceId: evidenceItems.workspaceId,
    })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, args.workspaceId), eq(evidenceItems.id, args.evidenceId)))
    .limit(1);
  if (!evidence) return { status: "not_found" as const };

  if (args.relatedWorkExperienceId) {
    const result = await validateTargetRow({
      db: args.db,
      evidenceWorkspaceId: evidence.workspaceId,
      id: args.relatedWorkExperienceId,
      table: workExperiences,
      workspaceId: args.workspaceId,
      notFoundReason: "related_work_experience_not_found",
      rejectedReason: "related_work_experience_rejected",
      crossWorkspaceReason: "cross_workspace_work_experience_link",
    });
    if (result.status !== "valid") return result;
  }
  if (args.relatedInitiativeId) {
    const result = await validateTargetRow({
      db: args.db,
      evidenceWorkspaceId: evidence.workspaceId,
      id: args.relatedInitiativeId,
      table: initiatives,
      workspaceId: args.workspaceId,
      notFoundReason: "related_initiative_not_found",
      rejectedReason: "related_initiative_rejected",
      crossWorkspaceReason: "cross_workspace_initiative_link",
    });
    if (result.status !== "valid") return result;
  }
  if (args.relatedPortfolioProjectId) {
    const result = await validateTargetRow({
      db: args.db,
      evidenceWorkspaceId: evidence.workspaceId,
      id: args.relatedPortfolioProjectId,
      table: portfolioProjects,
      workspaceId: args.workspaceId,
      notFoundReason: "related_portfolio_project_not_found",
      rejectedReason: "related_portfolio_project_rejected",
      crossWorkspaceReason: "cross_workspace_portfolio_project_link",
    });
    if (result.status !== "valid") return result;
  }
  return { status: "valid" as const };
}

async function validateTargetRow(args: {
  db: ReturnType<typeof getDb>;
  evidenceWorkspaceId: string;
  id: string;
  table: typeof workExperiences | typeof initiatives | typeof portfolioProjects;
  workspaceId: string;
  notFoundReason: string;
  rejectedReason: string;
  crossWorkspaceReason: string;
}) {
  const [target] = await args.db
    .select({
      id: args.table.id,
      workspaceId: args.table.workspaceId,
      status: args.table.status,
    })
    .from(args.table)
    .where(and(eq(args.table.workspaceId, args.workspaceId), eq(args.table.id, args.id)))
    .limit(1);
  if (!target) return { status: "invalid" as const, reason: args.notFoundReason };
  if (target.status === "rejected") {
    return { status: "invalid" as const, reason: args.rejectedReason };
  }
  if (target.workspaceId !== args.evidenceWorkspaceId) {
    return { status: "invalid" as const, reason: args.crossWorkspaceReason };
  }
  return { status: "valid" as const };
}

function toDedupeItem(item: typeof evidenceItems.$inferSelect): EvidenceDedupeItem {
  return {
    id: item.id,
    text: item.text,
    source_quote: item.sourceQuote,
    status: item.status,
    allowed_usage: item.allowedUsage,
    sensitivity_level: item.sensitivityLevel,
    evidence_type: item.evidenceType,
    needs_user_confirmation: item.needsUserConfirmation === 1,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toProjectDedupeItem(item: typeof projectCards.$inferSelect): ProjectDedupeItem {
  return {
    id: item.id,
    title: item.title,
    context: item.context,
    problem: item.problem,
    role: item.role,
    actions: item.actions,
    results: item.results,
    technologies: item.technologies,
    stakeholders: item.stakeholders,
    status: item.status,
    updatedAt: item.updatedAt.toISOString(),
  };
}

type StoryDedupeItemWithWorkspace = StoryDedupeItem & {
  workspaceId: string;
};

function toInitiativeDedupeItem(item: typeof initiatives.$inferSelect): StoryDedupeItemWithWorkspace {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    storyType: "initiative",
    title: item.externalSafeTitle ?? item.internalTitle,
    internalTitle: item.internalTitle,
    externalSafeTitle: item.externalSafeTitle,
    context: item.context,
    problem: item.problem,
    role: item.role,
    actions: item.actions,
    results: item.results,
    technologies: item.technologies,
    stakeholders: item.stakeholders,
    sensitivityLevel: item.sensitivityLevel,
    needsRedactionReview: item.needsRedactionReview === 1,
    status: item.status,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function toPortfolioProjectDedupeItem(
  item: typeof portfolioProjects.$inferSelect,
): StoryDedupeItemWithWorkspace {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    storyType: "portfolio_project",
    title: item.externalSafeTitle ?? item.title,
    internalTitle: item.title,
    externalSafeTitle: item.externalSafeTitle,
    context: item.context,
    problem: item.problem,
    role: item.role,
    actions: item.actions,
    results: item.results,
    technologies: item.technologies,
    stakeholders: item.stakeholders,
    sensitivityLevel: item.sensitivityLevel,
    needsRedactionReview: item.needsRedactionReview === 1,
    status: item.status,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function stripStoryWorkspace(item: StoryDedupeItemWithWorkspace): StoryDedupeItem {
  const { workspaceId: _workspaceId, ...story } = item;
  return story;
}

async function getEvidenceCountByStoryTarget(
  db: ReturnType<typeof getDb>,
  stories: StoryDedupeItemWithWorkspace[],
) {
  const initiativeIds = stories
    .filter((story) => story.storyType === "initiative")
    .map((story) => story.id);
  const portfolioProjectIds = stories
    .filter((story) => story.storyType === "portfolio_project")
    .map((story) => story.id);
  const counts = new Map<string, number>();
  const initiativeEvidence =
    initiativeIds.length > 0
      ? await db
          .select({
            relatedInitiativeId: evidenceItems.relatedInitiativeId,
          })
          .from(evidenceItems)
          .where(
            and(
              eq(evidenceItems.workspaceId, stories[0]!.workspaceId),
              inArray(evidenceItems.relatedInitiativeId, initiativeIds),
            ),
          )
      : [];
  for (const item of initiativeEvidence) {
    if (!item.relatedInitiativeId) continue;
    counts.set(item.relatedInitiativeId, (counts.get(item.relatedInitiativeId) ?? 0) + 1);
  }
  const portfolioEvidence =
    portfolioProjectIds.length > 0
      ? await db
          .select({
            relatedPortfolioProjectId: evidenceItems.relatedPortfolioProjectId,
          })
          .from(evidenceItems)
          .where(
            and(
              eq(evidenceItems.workspaceId, stories[0]!.workspaceId),
              inArray(evidenceItems.relatedPortfolioProjectId, portfolioProjectIds),
            ),
          )
      : [];
  for (const item of portfolioEvidence) {
    if (!item.relatedPortfolioProjectId) continue;
    counts.set(
      item.relatedPortfolioProjectId,
      (counts.get(item.relatedPortfolioProjectId) ?? 0) + 1,
    );
  }
  return counts;
}

function buildExactTitleProjectClusters(
  projects: Array<typeof projectCards.$inferSelect>,
  evidenceCountByProject: Map<string, number>,
  ignoredPairs = new Set<string>(),
) {
  const byTitle = new Map<string, Array<typeof projectCards.$inferSelect>>();
  for (const project of projects) {
    const key = normalizeEvidenceText(project.title);
    if (!key) continue;
    const existing = byTitle.get(key) ?? [];
    existing.push(project);
    byTitle.set(key, existing);
  }

  const clusters: ProjectDedupeCandidate[] = [];
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const [primaryCandidate, ...duplicateCandidates] = [...group].sort((left, right) => {
      const priorityDelta = projectPriority(right) - projectPriority(left);
      if (priorityDelta !== 0) return priorityDelta;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
    const primary = primaryCandidate;
    const duplicates = duplicateCandidates.filter(
      (duplicate) => primary && !ignoredPairs.has(buildOverlapPairKey(primary.id, duplicate.id)),
    );
    if (!primary || duplicates.length === 0) continue;
    clusters.push({
      primary: toProjectDedupeItem(primary),
      duplicate: toProjectDedupeItem(duplicates[0]!),
      duplicateCount: duplicates.length,
      duplicateProjectIds: duplicates.map((project) => project.id),
      score: 1,
      reasons: ["exact title match"],
      primaryEvidenceCount: evidenceCountByProject.get(primary.id) ?? 0,
      duplicateEvidenceCount: duplicates.reduce(
        (count, project) => count + (evidenceCountByProject.get(project.id) ?? 0),
        0,
      ),
    });
  }
  return clusters;
}

function chooseDedupePrimary(
  left: typeof evidenceItems.$inferSelect,
  right: typeof evidenceItems.$inferSelect,
): [typeof evidenceItems.$inferSelect, typeof evidenceItems.$inferSelect] {
  const leftRank = evidencePriority(left);
  const rightRank = evidencePriority(right);
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? [left, right] : [right, left];
  }
  return left.updatedAt >= right.updatedAt ? [left, right] : [right, left];
}

function evidencePriority(item: typeof evidenceItems.$inferSelect) {
  let score = 0;
  if (item.status === "approved") score += 4;
  if (item.allowedUsage.includes("resume")) score += 2;
  if (!item.needsUserConfirmation) score += 1;
  if (item.evidenceType !== "inferred") score += 1;
  return score;
}

function chooseProjectDedupePrimary(
  left: typeof projectCards.$inferSelect,
  right: typeof projectCards.$inferSelect,
): [typeof projectCards.$inferSelect, typeof projectCards.$inferSelect] {
  const leftRank = projectPriority(left);
  const rightRank = projectPriority(right);
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? [left, right] : [right, left];
  }
  return left.updatedAt >= right.updatedAt ? [left, right] : [right, left];
}

function projectPriority(item: typeof projectCards.$inferSelect) {
  let score = 0;
  if (item.status === "approved") score += 4;
  if (item.context) score += 1;
  if (item.problem) score += 1;
  if (item.role) score += 1;
  score += Math.min(3, item.actions.length);
  score += Math.min(3, item.results.length);
  score += Math.min(2, item.metrics.length);
  return score;
}

function chooseStoryDedupePrimary(
  left: StoryDedupeItemWithWorkspace,
  right: StoryDedupeItemWithWorkspace,
): [StoryDedupeItemWithWorkspace, StoryDedupeItemWithWorkspace] {
  const leftRank = storyPriority(left);
  const rightRank = storyPriority(right);
  if (leftRank !== rightRank) {
    return leftRank > rightRank ? [left, right] : [right, left];
  }
  return left.updatedAt >= right.updatedAt ? [left, right] : [right, left];
}

function storyPriority(item: StoryDedupeItemWithWorkspace) {
  let score = 0;
  if (item.status === "approved") score += 4;
  if (item.context) score += 1;
  if (item.problem) score += 1;
  if (item.role) score += 1;
  if (item.externalSafeTitle) score += 1;
  if (!item.needsRedactionReview) score += 1;
  score += Math.min(3, item.actions.length);
  score += Math.min(3, item.results.length);
  return score;
}

function scoreStorySimilarity(
  left: StoryDedupeItemWithWorkspace,
  right: StoryDedupeItemWithWorkspace,
) {
  const leftTitle = normalizeEvidenceText(left.title);
  const rightTitle = normalizeEvidenceText(right.title);
  const titleMatch = scoreEvidenceSimilarity(left.title, right.title);
  const internalTitleMatch =
    left.internalTitle && right.internalTitle
      ? scoreEvidenceSimilarity(left.internalTitle, right.internalTitle)
      : { score: 0, reasons: [] };
  const leftBody = storyComparisonText(left);
  const rightBody = storyComparisonText(right);
  const bodyMatch = scoreEvidenceSimilarity(leftBody, rightBody);
  const leftTech = new Set(left.technologies.map((item) => normalizeEvidenceText(item)).filter(Boolean));
  const rightTech = new Set(right.technologies.map((item) => normalizeEvidenceText(item)).filter(Boolean));
  const sharedTechCount = [...leftTech].filter((item) => rightTech.has(item)).length;
  const techScore =
    leftTech.size > 0 && rightTech.size > 0
      ? sharedTechCount / Math.min(leftTech.size, rightTech.size)
      : 0;
  const exactTitle = Boolean(leftTitle && leftTitle === rightTitle);
  const score = Math.max(
    exactTitle ? 1 : 0,
    titleMatch.score,
    internalTitleMatch.score,
    bodyMatch.score * 0.92,
    techScore >= 0.8 && bodyMatch.score >= 0.45 ? 0.74 : 0,
  );
  const reasons = [];
  if (exactTitle) reasons.push("exact external-safe title match");
  else if (titleMatch.score >= 0.72 || internalTitleMatch.score >= 0.72) {
    reasons.push("similar story title");
  }
  if (bodyMatch.score >= 0.72) reasons.push("shared story wording");
  if (sharedTechCount > 0) reasons.push(`${sharedTechCount} shared technologies`);
  return {
    score,
    reasons: reasons.length > 0 ? reasons : ["similar story target"],
  };
}

function storyComparisonText(story: StoryDedupeItemWithWorkspace) {
  return [
    story.title,
    story.internalTitle,
    story.context,
    story.problem,
    story.role,
    ...story.actions,
    ...story.results,
    ...story.technologies,
  ]
    .filter(Boolean)
    .join(" ");
}

function scoreProjectSimilarity(
  left: typeof projectCards.$inferSelect,
  right: typeof projectCards.$inferSelect,
) {
  const leftTitle = normalizeEvidenceText(left.title);
  const rightTitle = normalizeEvidenceText(right.title);
  const titleMatch = scoreEvidenceSimilarity(left.title, right.title);
  const leftBody = projectComparisonText(left);
  const rightBody = projectComparisonText(right);
  const bodyMatch = scoreEvidenceSimilarity(leftBody, rightBody);
  const leftTech = new Set(left.technologies.map((item) => normalizeEvidenceText(item)).filter(Boolean));
  const rightTech = new Set(right.technologies.map((item) => normalizeEvidenceText(item)).filter(Boolean));
  const sharedTechCount = [...leftTech].filter((item) => rightTech.has(item)).length;
  const techScore =
    leftTech.size > 0 && rightTech.size > 0
      ? sharedTechCount / Math.min(leftTech.size, rightTech.size)
      : 0;
  const exactTitle = Boolean(leftTitle && leftTitle === rightTitle);
  const score = Math.max(
    exactTitle ? 1 : 0,
    titleMatch.score,
    bodyMatch.score * 0.92,
    techScore >= 0.8 && bodyMatch.score >= 0.45 ? 0.74 : 0,
  );
  const reasons = [];
  if (exactTitle) reasons.push("exact title match");
  else if (titleMatch.score >= 0.72) reasons.push("similar title");
  if (bodyMatch.score >= 0.72) reasons.push("shared story wording");
  if (sharedTechCount > 0) reasons.push(`${sharedTechCount} shared technologies`);
  return {
    score,
    reasons: reasons.length > 0 ? reasons : ["similar project story"],
  };
}

function projectComparisonText(project: typeof projectCards.$inferSelect) {
  return [
    project.title,
    project.context,
    project.problem,
    project.role,
    ...project.actions,
    ...project.results,
    ...project.technologies,
  ]
    .filter(Boolean)
    .join(" ");
}

function firstProjectValue(
  projects: Array<typeof projectCards.$inferSelect>,
  key: "context" | "problem" | "role" | "publicSafeSummary",
) {
  return projects.map((project) => project[key]).find(Boolean) ?? null;
}

function firstInitiativeValue(
  stories: Array<typeof initiatives.$inferSelect>,
  key: "externalSafeTitle" | "externalSafeSummary",
) {
  return stories.map((story) => story[key]).find(Boolean) ?? null;
}

function mergeNullableText(primary: string | null, values: Array<string | null>) {
  const merged = mergeStringArrays(primary ? [primary] : [], values.filter((value): value is string => Boolean(value)));
  return merged.length > 0 ? merged.join(" ") : null;
}

function scoreEvidenceSimilarity(left: string, right: string) {
  const leftNormalized = normalizeEvidenceText(left);
  const rightNormalized = normalizeEvidenceText(right);
  if (!leftNormalized || !rightNormalized) return { score: 0, reasons: [] };
  if (leftNormalized === rightNormalized) {
    return { score: 1, reasons: ["exact normalized text match"] };
  }
  const leftTokens = new Set(toEvidenceTokens(leftNormalized));
  const rightTokens = new Set(toEvidenceTokens(rightNormalized));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return { score: 0, reasons: [] };
  }
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const smaller = Math.min(leftTokens.size, rightTokens.size);
  const larger = Math.max(leftTokens.size, rightTokens.size);
  const containment = overlap / smaller;
  const jaccard = overlap / (leftTokens.size + rightTokens.size - overlap);
  const score = Math.max(jaccard, containment * 0.86);
  const reasons = [];
  if (containment >= 0.84) reasons.push("high token containment");
  if (jaccard >= 0.72) reasons.push("high token overlap");
  return { score, reasons: reasons.length > 0 ? reasons : ["similar wording"] };
}

function normalizeEvidenceText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toEvidenceTokens(text: string) {
  const stopwords = new Set([
    "and",
    "for",
    "from",
    "the",
    "to",
    "with",
    "into",
    "that",
    "this",
    "was",
    "were",
  ]);
  return text
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

function mergeJsonArrays(
  left: Array<Record<string, unknown>>,
  right: Array<Record<string, unknown>>,
) {
  const seen = new Set<string>();
  return [...left, ...right].filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeStringArrays(left: string[], right: string[]) {
  const seen = new Set<string>();
  return [...left, ...right].filter((item) => {
    const normalized = normalizeEvidenceText(item);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function inferSourceTitle(
  extraction: ProfileEvidenceExtraction,
  sourceText: string,
) {
  const name = extraction.profile.name.value;
  if (name.trim()) return `${name.trim()} profile source`;
  return (
    sourceText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "Profile source"
  ).slice(0, 240);
}

function buildWorkExperienceDraftKey(
  experience: ProfileEvidenceExtraction["work_experiences"][number],
) {
  return [experience.employer, experience.role_title].filter(Boolean).join(" · ");
}

function profileExperiencesToWorkExperienceDrafts(
  experiences: ProfileEvidenceExtraction["profile"]["experience"],
): ProfileEvidenceExtraction["work_experiences"] {
  return experiences.map((experience) => ({
    employer: experience.employer.value,
    role_title: experience.title.value,
    team: null,
    location: null,
    start_date: experience.start_date?.value ?? null,
    end_date: experience.end_date?.value ?? null,
    summary:
      experience.bullets
        .map((bullet) => bullet.value.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" ") || null,
    status: "pending",
  }));
}

function mergeWorkExperienceDrafts(
  primary: ProfileEvidenceExtraction["work_experiences"],
  fallback: ProfileEvidenceExtraction["work_experiences"],
): ProfileEvidenceExtraction["work_experiences"] {
  const byKey = new Map<string, ProfileEvidenceExtraction["work_experiences"][number]>();
  for (const experience of [...fallback, ...primary]) {
    const key = normalizeEvidenceText(buildWorkExperienceDraftKey(experience));
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeWorkExperienceDraft(existing, experience) : experience);
  }
  return Array.from(byKey.values());
}

function mergeWorkExperienceDraft(
  fallback: ProfileEvidenceExtraction["work_experiences"][number],
  primary: ProfileEvidenceExtraction["work_experiences"][number],
): ProfileEvidenceExtraction["work_experiences"][number] {
  return {
    ...fallback,
    ...primary,
    team: primary.team ?? fallback.team,
    location: primary.location ?? fallback.location,
    start_date: primary.start_date ?? fallback.start_date,
    end_date: primary.end_date ?? fallback.end_date,
    summary: primary.summary ?? fallback.summary,
    status: primary.status ?? fallback.status,
  };
}

function toCanonicalProfile(
  profile: ProfileEvidenceExtraction["profile"],
  sourceText: string,
) {
  return {
    contact: {
      name: toField(profile.name, "critical", sourceText),
      email: profile.email ? toField(profile.email, "critical", sourceText) : null,
      phone: profile.phone ? toField(profile.phone, "important", sourceText) : null,
      location: profile.location ? toField(profile.location, "nice_to_have", sourceText) : null,
      links: profile.links.map((link) => toField(link, "nice_to_have", sourceText)),
    },
    education: profile.education.map((item) => ({
      institution: toField(item.institution, "important", sourceText),
      degree: toField(item.degree, "critical", sourceText),
      field_of_study: item.field_of_study
        ? toField(item.field_of_study, "important", sourceText)
        : null,
      start_date: item.start_date ? toField(item.start_date, "important", sourceText) : null,
      end_date: item.end_date ? toField(item.end_date, "important", sourceText) : null,
    })),
    experience: profile.experience.map((item) => ({
      employer: toField(item.employer, "critical", sourceText),
      title: toField(item.title, "critical", sourceText),
      start_date: item.start_date ? toField(item.start_date, "critical", sourceText) : null,
      end_date: item.end_date ? toField(item.end_date, "critical", sourceText) : null,
      bullets: item.bullets.map((bullet) => toField(bullet, "important", sourceText)),
    })),
    skills: profile.skills.map((skill) => toField(skill, "important", sourceText)),
    certifications: profile.certifications.map((certification) =>
      toField(certification, "important", sourceText),
    ),
    missing_fields: profile.missing_fields,
    low_confidence_fields: profile.low_confidence_fields,
    invented_field_flags: profile.invented_field_flags,
  };
}

function applyProfileFactPatch(
  currentProfile: CanonicalProfileJson,
  patch: ProfileFactPatchRequest,
): CanonicalProfileJson {
  const profile = { ...currentProfile };
  const contact = isPlainRecord(profile.contact) ? { ...profile.contact } : {};
  if (patch.field === "contact") {
    const nextContact = { ...contact };
    if (patch.contact.name !== undefined) {
      nextContact.name = patch.contact.name ? makeManualProfileField(patch.contact.name, "critical") : null;
    }
    if (patch.contact.email !== undefined) {
      nextContact.email = patch.contact.email ? makeManualProfileField(patch.contact.email, "critical") : null;
    }
    if (patch.contact.phone !== undefined) {
      nextContact.phone = patch.contact.phone ? makeManualProfileField(patch.contact.phone, "important") : null;
    }
    if (patch.contact.location !== undefined) {
      nextContact.location = patch.contact.location
        ? makeManualProfileField(patch.contact.location, "nice_to_have")
        : null;
    }
    if (patch.contact.links !== undefined) {
      nextContact.links = uniqueNonEmptyStrings(patch.contact.links).map((link) =>
        makeManualProfileField(link, "nice_to_have"),
      );
    }
    profile.contact = nextContact;
    return profile;
  }
  if (patch.field === "location") {
    profile.contact = {
      ...contact,
      location: makeManualProfileField(patch.location, "nice_to_have"),
    };
    return profile;
  }
  if (patch.field === "education") {
    const nextEducation = patch.education.map(toManualEducationProfileItem);
    profile.education =
      patch.mode === "replace"
        ? dedupeEducationProfileItems(nextEducation)
        : dedupeEducationProfileItems([
            ...(Array.isArray(profile.education) ? profile.education : []),
            ...nextEducation,
          ]);
    return profile;
  }
  if (patch.field === "skills") {
    const existingSkills =
      patch.mode === "replace" ? [] : extractProfileFieldValues(profile.skills);
    profile.skills = uniqueNonEmptyStrings([...existingSkills, ...patch.skills]).map((skill) =>
      makeManualProfileField(skill, "important"),
    );
    return profile;
  }
  const existingCertifications =
    patch.mode === "replace" ? [] : extractProfileFieldValues(profile.certifications);
  profile.certifications = uniqueNonEmptyStrings(
    [...existingCertifications, ...patch.certifications],
  ).map((certification) =>
    makeManualProfileField(certification, "important"),
  );
  return profile;
}

function toManualEducationProfileItem(item: {
  degree: string;
  endDate?: string;
  fieldOfStudy?: string;
  institution: string;
  startDate?: string;
}) {
  return {
    institution: makeManualProfileField(item.institution, "important"),
    degree: makeManualProfileField(item.degree, "critical"),
    field_of_study: item.fieldOfStudy
      ? makeManualProfileField(item.fieldOfStudy, "important")
      : null,
    start_date: item.startDate ? makeManualProfileField(item.startDate, "important") : null,
    end_date: item.endDate ? makeManualProfileField(item.endDate, "important") : null,
  };
}

function dedupeEducationProfileItems(items: unknown[]) {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of items) {
    const key = JSON.stringify([
      extractEducationFieldValue(item, "institution"),
      extractEducationFieldValue(item, "degree"),
      extractEducationFieldValue(item, "field_of_study"),
      extractEducationFieldValue(item, "end_date"),
    ]).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractEducationFieldValue(item: unknown, field: string) {
  if (!isPlainRecord(item)) return "";
  return extractProfileFieldValue(item[field]) ?? "";
}

function extractProfileFieldValues(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => extractProfileFieldValue(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function makeManualProfileField(value: string, tier: FieldTier) {
  const normalized = value.trim();
  return {
    confidence: 1,
    source_offset: null,
    source_quote: normalized,
    tier,
    value: normalized,
    verified: true,
  };
}

function uniqueNonEmptyStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function extractManualProfileDisplayName(profile: CanonicalProfileJson) {
  const contact = isPlainRecord(profile.contact) ? profile.contact : null;
  const name = contact ? extractProfileFieldValue(contact.name) : null;
  return name || null;
}

function extractProfileFieldValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (isPlainRecord(value) && typeof value.value === "string") {
    return value.value.trim() || null;
  }
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toField(
  field: {
    value: string;
    source_quote: string;
    confidence?: number;
  },
  tier: FieldTier,
  sourceText: string,
) {
  const offset = findSourceOffset(sourceText, field.source_quote);
  return {
    value: field.value,
    source_quote: field.source_quote,
    source_offset: offset,
    verified: offset !== null,
    tier,
    confidence: field.confidence ?? 0,
  };
}

function findSourceOffset(sourceText: string, sourceQuote: string) {
  const exactOffset = sourceText.indexOf(sourceQuote);
  if (exactOffset >= 0) return exactOffset;
  const normalizedQuote = normalizeSourceSpan(sourceQuote);
  if (!normalizedQuote) return null;
  const normalizedSource = normalizeSourceSpan(sourceText);
  const normalizedOffset = normalizedSource.indexOf(normalizedQuote);
  if (normalizedOffset < 0) return null;
  return mapNormalizedOffsetToSourceOffset(sourceText, normalizedOffset);
}

function normalizeSourceSpan(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function mapNormalizedOffsetToSourceOffset(sourceText: string, normalizedOffset: number) {
  let normalizedIndex = 0;
  let inWhitespace = false;
  for (let sourceIndex = 0; sourceIndex < sourceText.length; sourceIndex += 1) {
    const char = sourceText[sourceIndex];
    if (/\s/.test(char ?? "")) {
      if (inWhitespace) continue;
      inWhitespace = true;
      if (normalizedIndex === normalizedOffset) return sourceIndex;
      normalizedIndex += 1;
      continue;
    }
    inWhitespace = false;
    if (normalizedIndex === normalizedOffset) return sourceIndex;
    normalizedIndex += 1;
  }
  return null;
}

function evaluateEvidenceGuardrails(
  item: ProfileEvidenceExtraction["evidence_items"][number],
  sourceText: string,
) {
  const quoteFound = sourceText.includes(item.source_quote);
  const groundedMetrics = item.metrics.filter((metric) =>
    metricNumbersAreInQuote(metric.value, metric.source_quote),
  );
  return {
    metrics: groundedMetrics as Array<Record<string, unknown>>,
    needsUserConfirmation:
      item.needs_user_confirmation ||
      item.evidence_type === "inferred" ||
      !quoteFound ||
      groundedMetrics.length !== item.metrics.length,
  };
}

function metricNumbersAreInQuote(value: string, quote: string) {
  const numbers = value.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
  return numbers.every((number) => quote.includes(number));
}
