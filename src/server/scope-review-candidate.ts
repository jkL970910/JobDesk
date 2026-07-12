import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  enrichmentAnswers,
  enrichmentTasks,
  evidenceItems,
  initiatives,
  portfolioProjects,
  profileContextAnswers,
  scopeReviewCandidates,
  workExperiences,
  type enrichmentTaskSourceTypeEnum,
  type enrichmentTaskTargetConfidenceEnum,
  type portfolioProjectTypeEnum,
} from "../db/schema";
import { getDb, hasDatabaseUrl } from "../db/client";
import type { ScopeClassificationResult } from "./scope-classifier";
import { classifyExtractedAssetCandidate } from "./scope-classifier";
import { recordScopeCorrectionEvent } from "./scope-correction-audit";
import { getCurrentWorkspace } from "./workspace-repository";

export type ScopeReviewCandidatePayload = {
  kind: "scope_review_candidate";
  candidateId: string;
  proposedScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "enrichment_question";
  classifierAcceptedScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "unassigned";
  guardrailDecision:
    | "can_persist_to_canonical_pending"
    | "persist_unassigned_pending"
    | "review_queue_only"
    | "reject_as_invalid_scope";
  guardrailReason: string;
  confidence: "low" | "medium" | "high";
  sourceDocumentId?: string | null;
  sourceLabel: string;
  sourceQuote?: string | null;
  sourceSection?: string | null;
  rawCandidateText: string;
  sourceSnippet: string;
  suggestedAction:
    | "save_as_evidence"
    | "save_as_work_initiative"
    | "save_as_portfolio_project"
    | "save_as_profile_context"
    | "save_as_unassigned"
    | "review_scope"
    | "dismiss";
  resolutionStatus: "open" | "resolved" | "dismissed";
};

export type CandidateReviewAction =
  | "save_as_evidence"
  | "save_as_work_initiative"
  | "save_as_portfolio_project"
  | "save_as_profile_context"
  | "save_as_unassigned"
  | "dismiss";

type DbHandle = ReturnType<typeof getDb>;
type DbExecutor = Pick<DbHandle, "insert" | "select" | "update">;

type ScopeReviewCandidateSourceType =
  (typeof enrichmentTaskSourceTypeEnum.enumValues)[number];

type ScopeReviewCandidateConfidence =
  (typeof enrichmentTaskTargetConfidenceEnum.enumValues)[number];

type CandidatePortfolioProjectType =
  (typeof portfolioProjectTypeEnum.enumValues)[number];

export function buildScopeReviewCandidatePayload(args: {
  classification: ScopeClassificationResult;
  label: string;
  proposedScope: ScopeReviewCandidatePayload["proposedScope"];
  sourceDocumentId?: string | null;
  sourceLabel: string;
  sourceQuote?: string | null;
  sourceSection?: string | null;
}) {
  const sourceSnippet = args.label.trim() || `Untitled ${args.proposedScope.replace(/_/g, " ")} candidate`;
  const sourceQuote = args.sourceQuote?.trim() || null;
  return {
    kind: "scope_review_candidate" as const,
    candidateId: `scope:${crypto
      .createHash("sha256")
      .update([
        args.sourceDocumentId ?? "",
        args.sourceLabel,
        args.proposedScope,
        sourceSnippet,
        args.classification.decision.reason,
      ].join("|"))
      .digest("hex")
      .slice(0, 24)}`,
    proposedScope: args.proposedScope,
    classifierAcceptedScope: args.classification.decision.acceptedScope,
    guardrailDecision: args.classification.decision.canonicalLinkPolicy,
    guardrailReason: args.classification.decision.reason,
    confidence: args.classification.decision.confidence,
    sourceDocumentId: args.sourceDocumentId ?? null,
    sourceLabel: args.sourceLabel,
    sourceQuote,
    sourceSection: args.sourceSection ?? args.sourceLabel,
    rawCandidateText: sourceSnippet,
    sourceSnippet,
    suggestedAction: suggestScopeReviewAction(args.classification),
    resolutionStatus: "open" as const,
  };
}

function suggestScopeReviewAction(
  classification: ScopeClassificationResult,
): ScopeReviewCandidatePayload["suggestedAction"] {
  if (classification.decision.canonicalLinkPolicy === "reject_as_invalid_scope") {
    return "review_scope";
  }
  return suggestActionFromAcceptedScope(classification.decision.acceptedScope);
}

function suggestActionFromAcceptedScope(
  acceptedScope: ScopeReviewCandidatePayload["classifierAcceptedScope"],
): ScopeReviewCandidatePayload["suggestedAction"] {
  if (acceptedScope === "profile_context") return "save_as_profile_context";
  if (acceptedScope === "evidence_claim") return "save_as_evidence";
  if (acceptedScope === "work_initiative") return "save_as_work_initiative";
  if (acceptedScope === "portfolio_project") return "save_as_portfolio_project";
  return "review_scope";
}

export async function upsertScopeReviewCandidateForTask(
  db: Pick<DbHandle, "insert">,
  args: {
    now: Date;
    payload: ScopeReviewCandidatePayload;
    sourceType: ScopeReviewCandidateSourceType;
    taskId: string;
    workspaceId: string;
  },
) {
  await db
    .insert(scopeReviewCandidates)
    .values(toScopeReviewCandidateInsert(args))
    .onConflictDoUpdate({
      target: scopeReviewCandidates.id,
      set: {
        taskId: args.taskId,
        sourceDocumentId: args.payload.sourceDocumentId ?? null,
        sourceType: args.sourceType,
        sourceSection: args.payload.sourceSection ?? null,
        sourceQuote: args.payload.sourceQuote ?? null,
        rawCandidateText: args.payload.rawCandidateText || args.payload.sourceSnippet,
        proposedScope: args.payload.proposedScope,
        classifierScope: args.payload.classifierAcceptedScope,
        guardrailDecision: args.payload.guardrailDecision,
        guardrailReason: args.payload.guardrailReason,
        confidence: args.payload.confidence,
        suggestedAction: args.payload.suggestedAction,
        updatedAt: args.now,
      },
    });
}

export async function applyCandidateReviewAction(args: {
  action: CandidateReviewAction;
  candidateId: string;
  payload?: {
    title?: string;
    workExperienceId?: string | null;
    projectType?: CandidatePortfolioProjectType;
    evidenceText?: string;
    sourceQuote?: string;
    profileContextText?: string;
  };
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  const [candidate] = await db
    .select()
    .from(scopeReviewCandidates)
    .where(and(eq(scopeReviewCandidates.workspaceId, workspace.id), eq(scopeReviewCandidates.id, args.candidateId)))
    .limit(1);
  if (!candidate) return { status: "not_found" as const };
  if (candidate.status !== "open") {
    return { status: "invalid" as const, reason: "candidate_already_resolved" as const };
  }

  return db.transaction(async (tx) => {
    switch (args.action) {
      case "dismiss":
        return resolveCandidate(tx, {
          action: args.action,
          candidate,
          now,
          resolvedAsTargetId: null,
          resolvedAsTargetType: null,
          status: "dismissed",
        });
      case "save_as_unassigned":
        return saveCandidateAsUnassigned(tx, { candidate, now });
      case "save_as_profile_context":
        return saveCandidateAsProfileContext(tx, { candidate, now, text: args.payload?.profileContextText });
      case "save_as_evidence":
        return saveCandidateAsEvidence(tx, {
          candidate,
          evidenceText: args.payload?.evidenceText,
          now,
          sourceQuote: args.payload?.sourceQuote,
        });
      case "save_as_work_initiative":
        return saveCandidateAsWorkInitiative(tx, {
          candidate,
          now,
          title: args.payload?.title,
          workExperienceId: args.payload?.workExperienceId,
        });
      case "save_as_portfolio_project":
        return saveCandidateAsPortfolioProject(tx, {
          candidate,
          now,
          projectType: args.payload?.projectType,
          title: args.payload?.title,
        });
    }
  });
}

function toScopeReviewCandidateInsert(args: {
  now: Date;
  payload: ScopeReviewCandidatePayload;
  sourceType: ScopeReviewCandidateSourceType;
  taskId: string;
  workspaceId: string;
}) {
  return {
    id: args.payload.candidateId,
    workspaceId: args.workspaceId,
    taskId: args.taskId,
    sourceDocumentId: args.payload.sourceDocumentId ?? null,
    sourceType: args.sourceType,
    sourceSection: args.payload.sourceSection ?? null,
    sourceQuote: args.payload.sourceQuote ?? null,
    rawCandidateText: args.payload.rawCandidateText || args.payload.sourceSnippet,
    proposedScope: args.payload.proposedScope,
    classifierScope: args.payload.classifierAcceptedScope,
    guardrailDecision: args.payload.guardrailDecision,
    guardrailReason: args.payload.guardrailReason,
    confidence: args.payload.confidence,
    suggestedAction: args.payload.suggestedAction,
    status: "open",
    createdAt: args.now,
    updatedAt: args.now,
  } satisfies typeof scopeReviewCandidates.$inferInsert;
}

async function saveCandidateAsProfileContext(
  db: DbExecutor,
  args: {
    candidate: typeof scopeReviewCandidates.$inferSelect;
    now: Date;
    text?: string;
  },
) {
  const text = (args.text ?? args.candidate.rawCandidateText).trim();
  if (!text) return { status: "invalid" as const, reason: "missing_profile_context_text" as const };
  let answerId: string | null = null;
  if (args.candidate.taskId) {
    const [answer] = await db
      .insert(enrichmentAnswers)
      .values({
        workspaceId: args.candidate.workspaceId,
        taskId: args.candidate.taskId,
        answerText: text,
        answerStatus: "applied",
        createdAt: args.now,
        updatedAt: args.now,
      })
      .returning({ id: enrichmentAnswers.id });
    answerId = answer?.id ?? null;
  }
  const [context] = await db
    .insert(profileContextAnswers)
    .values({
      workspaceId: args.candidate.workspaceId,
      sourceTaskId: args.candidate.taskId,
      sourceAnswerId: answerId,
      contextType: "general_preference",
      answerText: text,
      normalizedTags: [],
      status: "pending",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning({ id: profileContextAnswers.id });
  if (!context) throw new Error("Failed to save candidate profile context.");
  return resolveCandidate(db, {
    action: "save_as_profile_context",
    candidate: args.candidate,
    now: args.now,
    resolvedAsTargetId: context.id,
    resolvedAsTargetType: "profile_context",
    status: "resolved",
  });
}

async function saveCandidateAsUnassigned(
  db: DbExecutor,
  args: {
    candidate: typeof scopeReviewCandidates.$inferSelect;
    now: Date;
  },
) {
  const [updated] = await db
    .update(scopeReviewCandidates)
    .set({
      resolvedAsTargetId: null,
      resolvedAsTargetType: "unassigned",
      resolutionPayloadJson: {
        action: "save_as_unassigned",
        resolvedAsTargetType: "unassigned",
      },
      suggestedAction: "review_scope",
      updatedAt: args.now,
    })
    .where(eq(scopeReviewCandidates.id, args.candidate.id))
    .returning();
  if (!updated) throw new Error("Failed to save unassigned scope review candidate.");
  await recordScopeCorrectionEvent(db, {
    action: "save_as_unassigned",
    before: {
      confidence: args.candidate.confidence,
      entityStatus: args.candidate.status,
      fromScope: args.candidate.proposedScope,
      label: `${args.candidate.proposedScope} -> unassigned`,
      sourceSection: args.candidate.sourceSection,
      sourceState: args.candidate.sourceDocumentId ? "linked" : "missing",
      toScope: "unassigned",
    },
    after: {
      entityStatus: updated.status,
      label: "Kept in review queue for later assignment",
      toScope: "unassigned",
    },
    entityId: null,
    entityType: "scope_review_candidate",
    sourceCandidateId: args.candidate.id,
    sourceTaskId: args.candidate.taskId,
    workspaceId: args.candidate.workspaceId,
  });
  return {
    status: "saved" as const,
    candidate: updated,
  };
}

async function saveCandidateAsEvidence(
  db: DbExecutor,
  args: {
    candidate: typeof scopeReviewCandidates.$inferSelect;
    evidenceText?: string;
    now: Date;
    sourceQuote?: string;
  },
) {
  const text = (args.evidenceText ?? args.candidate.rawCandidateText).trim();
  const sourceQuote = (args.sourceQuote ?? args.candidate.sourceQuote ?? "").trim();
  const classification = classifyCandidateForDestination(args.candidate, {
    proposedScope: "evidence_claim",
    sourceQuote,
    text,
  });
  if (
    classification.decision.acceptedScope !== "evidence_claim" ||
    classification.decision.canonicalLinkPolicy !== "can_persist_to_canonical_pending"
  ) {
    return { status: "invalid" as const, reason: "candidate_not_atomic_evidence" as const };
  }
  if (!args.candidate.sourceDocumentId) {
    return { status: "invalid" as const, reason: "missing_evidence_source_document" as const };
  }
  if (!text || !sourceQuote) {
    return { status: "invalid" as const, reason: "missing_evidence_source_quote" as const };
  }
  const [evidence] = await db
    .insert(evidenceItems)
    .values({
      workspaceId: args.candidate.workspaceId,
      sourceDocumentId: args.candidate.sourceDocumentId,
      text,
      sourceQuote,
      evidenceType: "extracted",
      metrics: [],
      sensitivityLevel: "private",
      allowedUsage: [],
      status: "pending",
      needsUserConfirmation: 1,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning({ id: evidenceItems.id });
  if (!evidence) throw new Error("Failed to save candidate evidence.");
  return resolveCandidate(db, {
    action: "save_as_evidence",
    candidate: args.candidate,
    now: args.now,
    resolvedAsTargetId: evidence.id,
    resolvedAsTargetType: "evidence",
    status: "resolved",
  });
}

async function saveCandidateAsWorkInitiative(
  db: DbExecutor,
  args: {
    candidate: typeof scopeReviewCandidates.$inferSelect;
    now: Date;
    title?: string;
    workExperienceId?: string | null;
  },
) {
  if (!args.workExperienceId) {
    return { status: "invalid" as const, reason: "missing_work_experience" as const };
  }
  const title = normalizeTitle(args.title ?? args.candidate.rawCandidateText);
  if (!title) return { status: "invalid" as const, reason: "missing_story_title" as const };
  const [experience] = await db
    .select({
      employer: workExperiences.employer,
      id: workExperiences.id,
      roleTitle: workExperiences.roleTitle,
      status: workExperiences.status,
    })
    .from(workExperiences)
    .where(
      and(
        eq(workExperiences.workspaceId, args.candidate.workspaceId),
        eq(workExperiences.id, args.workExperienceId),
      ),
    )
    .limit(1);
  if (!experience || experience.status === "rejected") {
    return { status: "invalid" as const, reason: "work_experience_not_found" as const };
  }
  const classification = classifyCandidateForDestination(args.candidate, {
    proposedScope: "work_initiative",
    text: args.candidate.rawCandidateText,
    linkedWorkExperience: experience,
  });
  if (
    classification.decision.acceptedScope !== "work_initiative" ||
    classification.decision.canonicalLinkPolicy !== "can_persist_to_canonical_pending"
  ) {
    return { status: "invalid" as const, reason: "candidate_not_work_initiative" as const };
  }
  const [initiative] = await db
    .insert(initiatives)
    .values({
      workspaceId: args.candidate.workspaceId,
      workExperienceId: experience.id,
      sourceDocumentId: args.candidate.sourceDocumentId,
      internalTitle: title,
      context: args.candidate.rawCandidateText,
      status: "pending",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning({ id: initiatives.id });
  if (!initiative) throw new Error("Failed to save candidate story target.");
  return resolveCandidate(db, {
    action: "save_as_work_initiative",
    candidate: args.candidate,
    now: args.now,
    resolvedAsTargetId: initiative.id,
    resolvedAsTargetType: "work_initiative",
    status: "resolved",
  });
}

async function saveCandidateAsPortfolioProject(
  db: DbExecutor,
  args: {
    candidate: typeof scopeReviewCandidates.$inferSelect;
    now: Date;
    projectType?: CandidatePortfolioProjectType;
    title?: string;
  },
) {
  const classification = classifyCandidateForDestination(args.candidate, {
    proposedScope: "portfolio_project",
    text: args.candidate.rawCandidateText,
  });
  if (
    classification.decision.acceptedScope !== "portfolio_project" ||
    classification.decision.canonicalLinkPolicy !== "can_persist_to_canonical_pending"
  ) {
    return { status: "invalid" as const, reason: "candidate_not_portfolio_project" as const };
  }
  const title = normalizeTitle(args.title ?? args.candidate.rawCandidateText);
  if (!title) return { status: "invalid" as const, reason: "missing_story_title" as const };
  const [project] = await db
    .insert(portfolioProjects)
    .values({
      workspaceId: args.candidate.workspaceId,
      sourceDocumentId: args.candidate.sourceDocumentId,
      projectType: args.projectType ?? "general_project",
      title,
      context: args.candidate.rawCandidateText,
      status: "pending",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning({ id: portfolioProjects.id });
  if (!project) throw new Error("Failed to save candidate portfolio project.");
  return resolveCandidate(db, {
    action: "save_as_portfolio_project",
    candidate: args.candidate,
    now: args.now,
    resolvedAsTargetId: project.id,
    resolvedAsTargetType: "portfolio_project",
    status: "resolved",
  });
}

async function resolveCandidate(
  db: DbExecutor,
  args: {
    action: CandidateReviewAction;
    candidate: typeof scopeReviewCandidates.$inferSelect;
    now: Date;
    resolvedAsTargetId: string | null;
    resolvedAsTargetType: string | null;
    status: "resolved" | "dismissed";
  },
) {
  const [updated] = await db
    .update(scopeReviewCandidates)
    .set({
      status: args.status,
      resolvedAsTargetId: args.resolvedAsTargetId,
      resolvedAsTargetType: args.resolvedAsTargetType,
      resolutionPayloadJson: {
        action: args.action,
        resolvedAsTargetType: args.resolvedAsTargetType,
      },
      resolvedAt: args.now,
      updatedAt: args.now,
    })
    .where(eq(scopeReviewCandidates.id, args.candidate.id))
    .returning();
  if (!updated) throw new Error("Failed to resolve scope review candidate.");
  if (args.candidate.taskId) {
    await db
      .update(enrichmentTasks)
      .set({
        status: args.status === "dismissed" ? "dismissed" : "converted",
        resolvedAt: args.now,
        dismissedAt: args.status === "dismissed" ? args.now : null,
        updatedAt: args.now,
      })
      .where(eq(enrichmentTasks.id, args.candidate.taskId));
  }
  await recordScopeCorrectionEvent(db, {
    action: args.action,
    before: {
      confidence: args.candidate.confidence,
      entityStatus: args.candidate.status,
      fromScope: args.candidate.proposedScope,
      label: `${args.candidate.proposedScope} -> ${args.candidate.classifierScope}`,
      sourceSection: args.candidate.sourceSection,
      sourceState: args.candidate.sourceDocumentId ? "linked" : "missing",
      toScope: args.candidate.classifierScope,
    },
    after: {
      entityStatus: updated.status,
      label: args.resolvedAsTargetType,
      toScope: args.resolvedAsTargetType,
    },
    entityId: args.resolvedAsTargetId,
    entityType: args.resolvedAsTargetType ?? "scope_review_candidate",
    sourceCandidateId: args.candidate.id,
    sourceTaskId: args.candidate.taskId,
    workspaceId: args.candidate.workspaceId,
  });
  return {
    status: "saved" as const,
    candidate: updated,
  };
}

function normalizeTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

function classifyCandidateForDestination(
  candidate: typeof scopeReviewCandidates.$inferSelect,
  args: {
    linkedWorkExperience?: { employer: string; id?: string; roleTitle: string } | null;
    proposedScope: "evidence_claim" | "portfolio_project" | "work_initiative";
    sourceQuote?: string | null;
    text: string;
  },
) {
  return classifyExtractedAssetCandidate(
    {
      content: args.text,
      proposedScope: args.proposedScope,
      sourceDocumentId: candidate.sourceDocumentId ?? undefined,
      sourceQuote: args.sourceQuote ?? candidate.sourceQuote ?? undefined,
      sourceSection: undefined,
    },
    {
      linkedWorkExperience: args.linkedWorkExperience
        ? {
            employer: args.linkedWorkExperience.employer,
            id: args.linkedWorkExperience.id,
            roleTitle: args.linkedWorkExperience.roleTitle,
            sourceSection: candidate.sourceSection,
          }
        : null,
    },
  );
}
