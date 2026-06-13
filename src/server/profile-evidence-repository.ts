import crypto from "node:crypto";

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  evidenceItems,
  generatedClaims,
  profiles,
  projectCards,
  sourceDocuments,
  workspaces,
  workflowRuns,
} from "../db/schema";
import type { JobDeskAiFailureKind, JobDeskAiUsage } from "../ai/types";
import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import { AllowedUsage } from "../schemas/shared";
import type { FieldTier, SensitivityLevel } from "../schemas/shared";
import {
  retrieveResumeEvidenceForJob,
  type ResumeRetrievalJobContext,
} from "./retrieval-service";
import { buildStarStoryCards } from "./star-story-service";

const defaultWorkspaceName = "Personal JobDesk";

export type ProfileEvidencePersistenceResult =
  | {
      status: "saved";
      workspaceId: string;
      profileId: string;
      sourceDocumentId: string;
      evidenceCount: number;
      projectCount: number;
      workflowRunId: string;
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    };

type DbHandle = ReturnType<typeof getDb>;

export async function persistProfileEvidenceExtraction(args: {
  sourceText: string;
  sourceTitle?: string;
  sourceType?: "profile-evidence" | "project-note";
  extraction: ProfileEvidenceExtraction;
  provider: string;
  model: string;
  usage: JobDeskAiUsage;
  retryCount: number;
}): Promise<ProfileEvidencePersistenceResult> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getOrCreateDefaultWorkspace(tx);
    const now = new Date();
    const title = args.sourceTitle?.trim() || inferSourceTitle(args.extraction, args.sourceText);
    const contentHash = crypto
      .createHash("sha256")
      .update(args.sourceText)
      .digest("hex");
    const [sourceDocument] = await tx
      .insert(sourceDocuments)
      .values({
        workspaceId: workspace.id,
        sourceType: args.sourceType ?? "profile-evidence",
        title,
        contentText: args.sourceText,
        contentHash,
        createdAt: now,
      })
      .returning({ id: sourceDocuments.id });
    if (!sourceDocument) {
      throw new Error("Failed to create profile source document.");
    }

    const canonicalProfile = toCanonicalProfile(args.extraction.profile);
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

    const projectIdByDraftId = new Map<string, string>();
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

    if (args.extraction.evidence_items.length > 0) {
      await tx.insert(evidenceItems).values(
        args.extraction.evidence_items.map((item) => {
          const guardrail = evaluateEvidenceGuardrails(item, args.sourceText);
          return {
            workspaceId: workspace.id,
            sourceDocumentId: sourceDocument.id,
            text: item.text,
            sourceQuote: item.source_quote,
            evidenceType: item.evidence_type,
            metrics: guardrail.metrics,
            sensitivityLevel: item.sensitivity_level,
            allowedUsage: item.allowed_usage,
            publicSafeSummary: item.public_safe_summary,
            status: item.status,
            relatedProjectId: item.related_project_id
              ? projectIdByDraftId.get(item.related_project_id) ?? null
              : null,
            needsUserConfirmation: guardrail.needsUserConfirmation ? 1 : 0,
            createdAt: now,
            updatedAt: now,
          };
        }),
      );
    }

    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        workflowType: "profile-evidence-extraction",
        status: "succeeded",
        provider: args.provider,
        model: args.model,
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

    return {
      status: "saved",
      workspaceId: workspace.id,
      profileId: profile.id,
      sourceDocumentId: sourceDocument.id,
      evidenceCount: args.extraction.evidence_items.length,
      projectCount: args.extraction.project_cards.length,
      workflowRunId: workflowRun.id,
    };
  });
}

export async function persistProfileEvidenceFailure(args: {
  provider: string;
  model: string;
  errorKind: JobDeskAiFailureKind | "unknown";
  errorMessage: string;
  retryCount: number;
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
      projectCards: [],
    };
  }

  const db = getDb();
  const [profile] = await db
    .select()
    .from(profiles)
    .orderBy(desc(profiles.updatedAt))
    .limit(1);
  const evidence = await db
    .select()
    .from(evidenceItems)
    .orderBy(desc(evidenceItems.updatedAt))
    .limit(limit);
  const projects = await db
    .select()
    .from(projectCards)
    .where(ne(projectCards.status, "rejected"))
    .orderBy(desc(projectCards.updatedAt))
    .limit(limit);

  return {
    profile: profile
      ? {
          id: profile.id,
          displayName: profile.displayName,
          updatedAt: profile.updatedAt.toISOString(),
          profile: profile.profileJson,
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
      updatedAt: item.updatedAt.toISOString(),
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

export async function getStarStoryBank(limit = 8) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const projects = await db
    .select()
    .from(projectCards)
    .where(ne(projectCards.status, "rejected"))
    .orderBy(desc(projectCards.updatedAt))
    .limit(80);
  if (projects.length === 0) {
    return { status: "ready" as const, stories: [] };
  }
  const evidence = await db
    .select()
    .from(evidenceItems)
    .where(inArray(evidenceItems.relatedProjectId, projects.map((project) => project.id)));

  return {
    status: "ready" as const,
    stories: buildStarStoryCards({
      projects,
      evidenceItems: evidence,
      limit,
    }),
  };
}

export async function getEvidenceDedupeCandidates(limit = 8) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const rows = await getDb()
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.status, "pending"))
    .orderBy(desc(evidenceItems.updatedAt))
    .limit(120);
  const candidates: EvidenceDedupeCandidate[] = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const left = rows[leftIndex]!;
      const right = rows[rightIndex]!;
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
  const rows = await db
    .select()
    .from(projectCards)
    .orderBy(desc(projectCards.updatedAt))
    .limit(120);
  const activeProjects = rows.filter((project) => project.status !== "rejected");
  if (activeProjects.length < 2) {
    return { status: "ready" as const, candidates: [] };
  }
  const linkedEvidence = await db
    .select({
      id: evidenceItems.id,
      relatedProjectId: evidenceItems.relatedProjectId,
    })
    .from(evidenceItems)
    .where(inArray(evidenceItems.relatedProjectId, activeProjects.map((project) => project.id)));
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

  const exactTitleClusters = buildExactTitleProjectClusters(activeProjects, evidenceCountByProject);
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
    const rows = await tx
      .select()
      .from(evidenceItems)
      .where(inArray(evidenceItems.id, [args.primaryEvidenceId, args.duplicateEvidenceId]));
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
      .where(eq(evidenceItems.id, primary.id));
    await tx
      .update(evidenceItems)
      .set({
        status: "rejected",
        updatedAt: now,
      })
      .where(eq(evidenceItems.id, duplicate.id));

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
    const rows = await tx
      .select()
      .from(projectCards)
      .where(inArray(projectCards.id, [args.primaryProjectId, ...duplicateIds]));
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
      .where(eq(projectCards.id, primary.id));

    const movedEvidence = await tx
      .update(evidenceItems)
      .set({
        relatedProjectId: primary.id,
        updatedAt: now,
      })
      .where(inArray(evidenceItems.relatedProjectId, duplicateIds))
      .returning({ id: evidenceItems.id });

    await tx
      .update(projectCards)
      .set({
        status: "rejected",
        updatedAt: now,
      })
      .where(inArray(projectCards.id, duplicateIds));

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
    }
    if (args.sensitivityLevel !== undefined) {
      patch.sensitivityLevel = args.sensitivityLevel;
    }
  }

  const [project] = await getDb()
    .update(projectCards)
    .set(patch)
    .where(eq(projectCards.id, args.projectId))
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
    ? ({ status: "saved" as const, projectCard: project })
    : ({ status: "not_found" as const });
}

export async function approveProjectEvidenceForResume(projectId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const linkedEvidence = await db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.relatedProjectId, projectId));
  const eligibleEvidence = linkedEvidence.filter(
    (item) =>
      item.sensitivityLevel !== "sensitive" &&
      item.evidenceType !== "inferred" &&
      !item.allowedUsage.includes("internal_only"),
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
    .where(inArray(evidenceItems.id, eligibleEvidence.map((item) => item.id)))
    .returning({ id: evidenceItems.id });

  return {
    status: "saved" as const,
    projectId,
    evidenceCount: updated.length,
    skippedCount: linkedEvidence.length - updated.length,
  };
}

export async function markClaimsStaleForEvidenceIds(evidenceIds: string[]) {
  if (!hasDatabaseUrl() || evidenceIds.length === 0) {
    return {
      status: "skipped" as const,
      reason: "missing_database_url_or_ids" as const,
    };
  }
  const rows = await getDb().select().from(generatedClaims);
  const impacted = rows.filter((claim) =>
    claim.evidenceIds.some((id) => evidenceIds.includes(id)),
  );
  if (impacted.length === 0) {
    return { status: "saved" as const, staleCount: 0 };
  }
  await getDb()
    .update(generatedClaims)
    .set({
      claimStatus: "stale",
      staleReason: "Linked evidence was edited or reclassified.",
      lastValidatedAt: null,
    })
    .where(inArray(generatedClaims.id, impacted.map((claim) => claim.id)));
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
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const patch: Partial<typeof evidenceItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (args.action === "edit" && args.relatedProjectId) {
    const validation = await validateEvidenceProjectLink({
      db,
      evidenceId: args.evidenceId,
      relatedProjectId: args.relatedProjectId,
    });
    if (validation.status !== "valid") return validation;
  }
  if (args.action === "approve") {
    patch.status = "approved";
    patch.needsUserConfirmation = 0;
  } else if (args.action === "approve_for_resume") {
    const [existing] = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.id, args.evidenceId))
      .limit(1);
    if (!existing) return { status: "not_found" as const };
    const requestedUsage = Array.from(
      new Set([...(args.allowedUsage ?? existing.allowedUsage), "resume"]),
    );
    if (existing.sensitivityLevel === "sensitive") {
      return {
        status: "invalid" as const,
        reason: "sensitive_evidence_requires_deidentification" as const,
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
    }
    if (args.allowedUsage !== undefined) {
      patch.allowedUsage = Array.from(new Set(args.allowedUsage));
    }
    if (args.sensitivityLevel !== undefined) {
      patch.sensitivityLevel = args.sensitivityLevel;
    }
    if (args.relatedProjectId !== undefined) {
      patch.relatedProjectId = args.relatedProjectId;
    }
    patch.needsUserConfirmation = 1;
  }

  const [item] = await db
    .update(evidenceItems)
    .set(patch)
    .where(eq(evidenceItems.id, args.evidenceId))
    .returning({
      id: evidenceItems.id,
      text: evidenceItems.text,
      status: evidenceItems.status,
      needsUserConfirmation: evidenceItems.needsUserConfirmation,
      publicSafeSummary: evidenceItems.publicSafeSummary,
      allowedUsage: evidenceItems.allowedUsage,
      sensitivityLevel: evidenceItems.sensitivityLevel,
      relatedProjectId: evidenceItems.relatedProjectId,
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
  const [profile] = await db
    .select()
    .from(profiles)
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

async function getOrCreateDefaultWorkspace(db: Pick<DbHandle, "select" | "insert">) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.name, defaultWorkspaceName))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(workspaces)
    .values({ name: defaultWorkspaceName })
    .returning();
  if (!created) {
    throw new Error("Failed to create workspace.");
  }
  return created;
}

async function validateEvidenceProjectLink(args: {
  db: ReturnType<typeof getDb>;
  evidenceId: string;
  relatedProjectId: string;
}) {
  const [evidence] = await args.db
    .select({
      id: evidenceItems.id,
      workspaceId: evidenceItems.workspaceId,
    })
    .from(evidenceItems)
    .where(eq(evidenceItems.id, args.evidenceId))
    .limit(1);
  if (!evidence) return { status: "not_found" as const };

  const [project] = await args.db
    .select({
      id: projectCards.id,
      workspaceId: projectCards.workspaceId,
      status: projectCards.status,
    })
    .from(projectCards)
    .where(eq(projectCards.id, args.relatedProjectId))
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

function buildExactTitleProjectClusters(
  projects: Array<typeof projectCards.$inferSelect>,
  evidenceCountByProject: Map<string, number>,
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
    const [primary, ...duplicates] = [...group].sort((left, right) => {
      const priorityDelta = projectPriority(right) - projectPriority(left);
      if (priorityDelta !== 0) return priorityDelta;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
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

function toCanonicalProfile(profile: ProfileEvidenceExtraction["profile"]) {
  return {
    contact: {
      name: toField(profile.name, "critical"),
      email: profile.email ? toField(profile.email, "critical") : null,
      phone: profile.phone ? toField(profile.phone, "important") : null,
      location: profile.location ? toField(profile.location, "nice_to_have") : null,
      links: profile.links.map((link) => toField(link, "nice_to_have")),
    },
    education: profile.education.map((item) => ({
      institution: toField(item.institution, "important"),
      degree: toField(item.degree, "critical"),
      field_of_study: item.field_of_study
        ? toField(item.field_of_study, "important")
        : null,
      start_date: item.start_date ? toField(item.start_date, "important") : null,
      end_date: item.end_date ? toField(item.end_date, "important") : null,
    })),
    experience: profile.experience.map((item) => ({
      employer: toField(item.employer, "critical"),
      title: toField(item.title, "critical"),
      start_date: item.start_date ? toField(item.start_date, "critical") : null,
      end_date: item.end_date ? toField(item.end_date, "critical") : null,
      bullets: item.bullets.map((bullet) => toField(bullet, "important")),
    })),
    skills: profile.skills.map((skill) => toField(skill, "important")),
    certifications: profile.certifications.map((certification) =>
      toField(certification, "important"),
    ),
    missing_fields: profile.missing_fields,
    low_confidence_fields: profile.low_confidence_fields,
    invented_field_flags: profile.invented_field_flags,
  };
}

function toField(
  field: {
    value: string;
    source_quote: string;
    confidence?: number;
  },
  tier: FieldTier,
) {
  return {
    value: field.value,
    source_quote: field.source_quote,
    source_offset: null,
    verified: false,
    tier,
    confidence: field.confidence ?? 0,
  };
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
