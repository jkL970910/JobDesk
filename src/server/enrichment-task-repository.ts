import crypto from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { resolveJobDeskAiConfig } from "../ai/config";
import { reviseEnrichmentProposalWithAi } from "../ai/enrichment-proposal-revision";
import { JobDeskAiError } from "../ai/errors";
import { extractProfileEvidenceWithAi } from "../ai/profile-evidence-extraction";
import { skillRegistry } from "../ai/skills-registry";
import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import {
  type ClarifyAssignmentProposalPatch,
  type CreateEvidenceProposalPatch,
  type EnrichmentProposalPatch,
  type EvidenceUpdateProposalPatch,
  type StructuredRoleProposalPatch,
  type StructuredStoryProposalPatch,
  parseClarifyAssignmentProposalPatch,
  parseCreateEvidenceProposalPatch,
  parseEvidenceUpdateProposalPatch,
  parseStructuredRoleProposalPatch,
  parseStructuredStoryProposalPatch,
} from "../schemas/enrichment-proposal-patches";
import type { JobDeskAiFailureKind, JobDeskAiSkillBinding } from "../ai/types";
import { getDb, hasDatabaseUrl } from "../db/client";
import {
  enrichmentAnswers,
  enrichmentProposalRevisions,
  enrichmentProposals,
  profileContextAnswers,
  enrichmentTaskTargets,
  enrichmentTasks,
  evidenceItems,
  generatedClaims,
  initiatives,
  portfolioProjects,
  sourceDocuments,
  resumeSourceVersions,
  workExperiences,
  workflowRuns,
  type enrichmentTaskSourceTypeEnum,
  type enrichmentTaskStatusEnum,
  type enrichmentTaskExpectedOutcomeEnum,
  type enrichmentTaskExpectedActionEnum,
  type enrichmentTaskNoteKindEnum,
  type enrichmentTaskTargetConfidenceEnum,
  type enrichmentTaskTargetKindEnum,
  type enrichmentTaskTargetRoleEnum,
  type enrichmentTaskTargetScopeEnum,
  type enrichmentTaskTypeEnum,
  type enrichmentProposalStatusEnum,
  type enrichmentProposalTypeEnum,
  type profileContextTypeEnum,
} from "../db/schema";
import { workflowSkillFields } from "./workflow-run-metadata";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";
import {
  type ScopeReviewCandidatePayload,
  upsertScopeReviewCandidateForTask,
} from "./scope-review-candidate";

type DbHandle = ReturnType<typeof getDb>;
type DbExecutor = Pick<DbHandle, "select" | "update" | "insert">;

export type EnrichmentTaskType =
  (typeof enrichmentTaskTypeEnum.enumValues)[number];
export type EnrichmentTaskStatus =
  (typeof enrichmentTaskStatusEnum.enumValues)[number];
export type EnrichmentTaskSourceType =
  (typeof enrichmentTaskSourceTypeEnum.enumValues)[number];
export type EnrichmentTaskTargetScope =
  (typeof enrichmentTaskTargetScopeEnum.enumValues)[number];
export type EnrichmentTaskTargetConfidence =
  (typeof enrichmentTaskTargetConfidenceEnum.enumValues)[number];
export type EnrichmentTaskExpectedOutcome =
  (typeof enrichmentTaskExpectedOutcomeEnum.enumValues)[number];
export type EnrichmentTaskNoteKind =
  (typeof enrichmentTaskNoteKindEnum.enumValues)[number];
export type EnrichmentTaskExpectedAction =
  (typeof enrichmentTaskExpectedActionEnum.enumValues)[number];
export type EnrichmentTaskTargetKind =
  (typeof enrichmentTaskTargetKindEnum.enumValues)[number];
export type EnrichmentTaskTargetRole =
  (typeof enrichmentTaskTargetRoleEnum.enumValues)[number];
export type EnrichmentProposalType =
  (typeof enrichmentProposalTypeEnum.enumValues)[number];
export type EnrichmentProposalStatus =
  (typeof enrichmentProposalStatusEnum.enumValues)[number];

export type EnrichmentProposalRevisionPayload = {
  id: string;
  proposal_id: string | null;
  next_proposal_id: string | null;
  actor: "user" | "ai";
  mode: "manual_edit" | "ai_revision";
  instruction: string | null;
  previous_text: string;
  revised_text: string;
  createdAt: string;
};

export type EnrichmentProposalPayload = {
  id: string;
  proposal_type: EnrichmentProposalType;
  status: EnrichmentProposalStatus;
  target_kind: EnrichmentTaskTargetKind | null;
  target_id: string | null;
  schema_version: string;
  proposed_patch_json: Record<string, unknown>;
  evidence_delta_json: Record<string, unknown> | null;
  committed_evidence_item_id: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
};

export type EnrichmentTaskTargetPayload = {
  target_kind: EnrichmentTaskTargetKind;
  target_id: string;
  target_role: EnrichmentTaskTargetRole;
  confidence: EnrichmentTaskTargetConfidence;
  accepted_at: string | null;
  created_by: string | null;
  reason: string | null;
  rejected_at: string | null;
};

export type EnrichmentTaskReviewPayload = ScopeReviewCandidatePayload;

export type EnrichmentTaskQueueFilters = {
  limit?: number;
  resumeReviewReportId?: string;
  resumeSourceVersionId?: string;
  sourceType?: EnrichmentTaskSourceType;
  statuses?: EnrichmentTaskStatus[];
};

export type EnrichmentTaskDraft = {
  taskType: EnrichmentTaskType;
  sourceType: EnrichmentTaskSourceType;
  sourceLabel: string;
  prompt: string;
  targetScope?: EnrichmentTaskTargetScope;
  targetConfidence?: EnrichmentTaskTargetConfidence;
  targetReason?: string | null;
  expectedOutcome?: EnrichmentTaskExpectedOutcome;
  noteKind?: EnrichmentTaskNoteKind | null;
  expectedAction?: EnrichmentTaskExpectedAction | null;
  targetField?: string | null;
  reviewPayload?: EnrichmentTaskReviewPayload | null;
  evidenceItemId?: string | null;
  workExperienceId?: string | null;
  initiativeId?: string | null;
  portfolioProjectId?: string | null;
  resumeSourceVersionId?: string | null;
  resumeReviewReportId?: string | null;
};

export type EnrichmentAnswerExtractorResult = {
  extraction: ProfileEvidenceExtraction;
  provider: string;
  model: string;
  usage: { inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null };
  retryCount: number;
  skill: JobDeskAiSkillBinding;
};

type ReusableLibraryAnchor = {
  evidenceItemId?: string | null;
  workExperienceId?: string | null;
  initiativeId?: string | null;
  portfolioProjectId?: string | null;
};

type EnrichmentStoryTargetCreation = {
  targetType: "initiative" | "portfolio_project";
  title: string;
  actions?: string[];
  context?: string | null;
  problem?: string | null;
  results?: string[];
  role?: string | null;
  sourceQuote?: string | null;
  technologies?: string[];
  workExperienceId?: string | null;
  projectType?: "personal_project" | "academic_project" | "open_source" | "freelance" | "hackathon" | "general_project";
};

type EnrichmentProposalDraft = {
  nextStepNote: string;
  patch: EnrichmentProposalPatch;
  proposalType: EnrichmentProposalType;
  targetId: string | null;
  targetKind: EnrichmentTaskTargetKind | null;
};

export async function getEnrichmentTaskQueue(filters: EnrichmentTaskQueueFilters | number = {}) {
  if (!hasDatabaseUrl()) {
    return {
      status: "skipped" as const,
      reason: "missing_database_url" as const,
      tasks: [],
    };
  }

  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const normalizedFilters =
    typeof filters === "number" ? ({ limit: filters } satisfies EnrichmentTaskQueueFilters) : filters;
  const limit = clampQueueLimit(normalizedFilters.limit);
  const conditions = [eq(enrichmentTasks.workspaceId, workspace.id)];
  if (normalizedFilters.sourceType) {
    conditions.push(eq(enrichmentTasks.sourceType, normalizedFilters.sourceType));
  }
  if (normalizedFilters.resumeSourceVersionId) {
    conditions.push(eq(enrichmentTasks.resumeSourceVersionId, normalizedFilters.resumeSourceVersionId));
  }
  if (normalizedFilters.resumeReviewReportId) {
    conditions.push(eq(enrichmentTasks.resumeReviewReportId, normalizedFilters.resumeReviewReportId));
  }
  if (normalizedFilters.statuses?.length) {
    conditions.push(inArray(enrichmentTasks.status, normalizedFilters.statuses));
  }
  const rows = await db
    .select()
    .from(enrichmentTasks)
    .where(and(...conditions))
    .orderBy(
      sql`case when ${enrichmentTasks.status} in ('open', 'answered') then 0 else 1 end`,
      desc(enrichmentTasks.updatedAt),
    )
    .limit(limit);
  const taskIds = rows.map((row) => row.id);
  const targetMap = await getTaskTargetMap(db, taskIds);
  const proposalMap = await getTaskProposalMap(db, taskIds);
  const revisionMap = await getTaskProposalRevisionMap(db, taskIds);

  return {
    status: "ready" as const,
    tasks: rows.map((row) =>
      toEnrichmentTaskPayload(
        row,
        targetMap.get(row.id),
        proposalMap.get(row.id),
        revisionMap.get(row.id),
      ),
    ),
  };
}

function clampQueueLimit(limit?: number) {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
}

export async function upsertEnrichmentTasks(
  db: Pick<DbHandle, "insert" | "delete">,
  args: {
    workspaceId: string;
    tasks: EnrichmentTaskDraft[];
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  const cleanTasks = args.tasks
    .map(normalizeTaskDraft)
    .filter((task): task is EnrichmentTaskDraft => task !== null);
  if (cleanTasks.length === 0) return [];

  const inserted = [];
  for (const task of cleanTasks) {
    const [row] = await db
      .insert(enrichmentTasks)
      .values({
        workspaceId: args.workspaceId,
        taskType: task.taskType,
        status: "open",
        sourceType: task.sourceType,
        sourceLabel: task.sourceLabel,
        prompt: task.prompt,
        dedupeKey: buildEnrichmentDedupeKey(task),
        ...deriveTaskTargetMetadata(task),
        noteKind: task.noteKind ?? null,
        expectedAction: task.expectedAction ?? null,
        targetField: task.targetField ?? null,
        reviewPayloadJson: task.reviewPayload ?? null,
        evidenceItemId: task.evidenceItemId ?? null,
        workExperienceId: task.workExperienceId ?? null,
        initiativeId: task.initiativeId ?? null,
        portfolioProjectId: task.portfolioProjectId ?? null,
        resumeSourceVersionId: task.resumeSourceVersionId ?? null,
        resumeReviewReportId: task.resumeReviewReportId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [enrichmentTasks.workspaceId, enrichmentTasks.dedupeKey],
        set: {
          sourceLabel: task.sourceLabel,
          prompt: task.prompt,
          reviewPayloadJson: task.reviewPayload ?? null,
          updatedAt: sql`case when ${enrichmentTasks.status} in ('open', 'answered') then ${now} else ${enrichmentTasks.updatedAt} end`,
        },
        targetWhere: undefined,
        setWhere: sql`${enrichmentTasks.status} in ('open', 'answered')`,
      })
      .returning();
    if (row) inserted.push(row);
    if (row) {
      if (task.reviewPayload?.kind === "scope_review_candidate") {
        await upsertScopeReviewCandidateForTask(db, {
          now,
          payload: task.reviewPayload,
          sourceType: task.sourceType,
          taskId: row.id,
          workspaceId: args.workspaceId,
        });
      }
      await replaceTaskTargets(db, {
        workspaceId: args.workspaceId,
        taskId: row.id,
        anchor: task,
        reason: "Initial target inferred from task source.",
        confidence: hasReusableLibraryAnchor(task) ? "medium" : "low",
      });
    }
  }
  return inserted;
}

export function buildResumeReviewEnrichmentTasks(args: {
  resumeTitle: string;
  resumeSourceVersionId: string;
  resumeReviewReportId: string;
  missingEvidenceQuestions: string[];
}): EnrichmentTaskDraft[] {
  return args.missingEvidenceQuestions.map((question) => {
    const profileContextDefaults = isBroadProfilePositioningQuestion(question)
      ? getProfileContextTaskDefaults()
      : {};
    return {
      taskType: classifyEnrichmentTask(question),
      sourceType: "resume_review" as const,
      sourceLabel: `${args.resumeTitle} review`,
      prompt: question,
      resumeSourceVersionId: args.resumeSourceVersionId,
      resumeReviewReportId: args.resumeReviewReportId,
      ...profileContextDefaults,
    };
  });
}

export function buildExtractionNoteEnrichmentTasks(args: {
  sourceTitle: string;
  notes: string[];
  sourceDocumentId?: string | null;
  reviewPayloads?: Array<{ note: string; payload: EnrichmentTaskReviewPayload }>;
}) {
  const seenNotes = new Set(args.notes);
  const noteTasks = args.notes.map((note) => {
    const classification = classifyExtractionNoteAction(note);
    const reviewPayload = findScopeReviewPayloadForNote(args.reviewPayloads, note, args.sourceDocumentId);
    if (classification.expectedAction !== "answer_enrichment_question") {
      return {
        taskType: "source_section_review" as const,
        sourceType: "extraction_note" as const,
        sourceLabel: args.sourceTitle,
        prompt: note,
        targetScope: "source_material" as const,
        targetConfidence: classification.confidence,
        targetReason: classification.reason,
        expectedOutcome: "review_imported_material" as const,
        noteKind: classification.noteKind,
        expectedAction: classification.expectedAction,
        targetField: classification.targetField,
        reviewPayload,
      };
    }
    return {
      taskType: classifyEnrichmentTask(note),
      sourceType: "extraction_note" as const,
      sourceLabel: args.sourceTitle,
      prompt: note,
    };
  });
  const payloadTasks = (args.reviewPayloads ?? [])
    .filter((item) => !seenNotes.has(item.note))
    .map((item) => {
      const payload = item.payload.sourceDocumentId || !args.sourceDocumentId
        ? item.payload
        : { ...item.payload, sourceDocumentId: args.sourceDocumentId };
      return {
        taskType: "source_section_review" as const,
        sourceType: "extraction_note" as const,
        sourceLabel: args.sourceTitle,
        prompt: item.note,
        targetScope: "source_material" as const,
        targetConfidence: payload.confidence,
        targetReason: payload.guardrailReason,
        expectedOutcome: "review_imported_material" as const,
        noteKind: "story_gap" as const,
        expectedAction: "review_import" as const,
        targetField: null,
        reviewPayload: payload,
      };
    });
  return [...noteTasks, ...payloadTasks];
}

function findScopeReviewPayloadForNote(
  reviewPayloads: Array<{ note: string; payload: EnrichmentTaskReviewPayload }> | undefined,
  note: string,
  sourceDocumentId?: string | null,
) {
  const payload = reviewPayloads?.find((item) => item.note === note)?.payload;
  if (!payload) return null;
  if (payload.sourceDocumentId || !sourceDocumentId) return payload;
  return { ...payload, sourceDocumentId };
}

function classifyExtractionNoteAction(note: string): {
  confidence: EnrichmentTaskTargetConfidence;
  expectedAction: EnrichmentTaskExpectedAction;
  noteKind: EnrichmentTaskNoteKind;
  reason: string;
  targetField: string | null;
} {
  const normalized = note.trim().toLowerCase().replace(/\s+/g, " ");
  const baseReason =
    "This imported-source note is for review, not a missing-information answer.";

  if (/\bscope review needed\b/.test(normalized)) {
    return {
      confidence: "high",
      expectedAction: "review_import",
      noteKind: "import_review",
      reason: "This note reports a scope classification guardrail. Review the imported source before creating canonical material.",
      targetField: null,
    };
  }

  if (looksLikeConcreteExtractionGap(normalized)) {
    return {
      confidence: "medium",
      expectedAction: "answer_enrichment_question",
      noteKind: looksLikeStoryGap(normalized) ? "story_gap" : "evidence_gap",
      reason: "This extraction note asks for a concrete story or evidence detail.",
      targetField: null,
    };
  }

  if (/\b(returned at most|omitted additional|beyond the first|not included due to|capped at)\b/.test(normalized)) {
    return {
      confidence: "high",
      expectedAction: "review_import",
      noteKind: "extraction_limit",
      reason: "This note reports an extraction limit. Review the imported source instead of answering it as evidence.",
      targetField: null,
    };
  }

  const roleField = inferRoleTargetField(normalized);
  if (
    roleField &&
    looksLikeRoleFieldNote(normalized)
  ) {
    return {
      confidence: "high",
      expectedAction: "edit_role_field",
      noteKind: "missing_role_field",
      reason: "This note points to a missing role field. Edit the role directly instead of saving a generic answer.",
      targetField: roleField,
    };
  }

  if (
    /\b(no certifications|certifications were not|certifications were not found|certifications were missing|certifications missing|certification missing)\b/.test(
      normalized,
    )
  ) {
    return {
      confidence: "high",
      expectedAction: "add_profile_fact",
      noteKind: "missing_profile_fact",
      reason: "This note reports missing certification data. Add a profile fact only if the source is incomplete.",
      targetField: "certifications",
    };
  }

  if (/\b(no personal location|profile\.location|personal location)\b/.test(normalized)) {
    return {
      confidence: "high",
      expectedAction: "edit_profile_fact",
      noteKind: "missing_profile_fact",
      reason: "This note reports a missing profile location. Edit profile facts instead of saving a generic answer.",
      targetField: "location",
    };
  }

  if (/\b(education|contact|skills?)\b/.test(normalized) && /\b(not found|not included|missing|not explicitly stated|not stated)\b/.test(normalized)) {
    return {
      confidence: "medium",
      expectedAction: "edit_profile_fact",
      noteKind: "missing_profile_fact",
      reason: "This note reports a missing profile fact. Edit the profile field directly if needed.",
      targetField: inferProfileTargetField(normalized),
    };
  }

  if (
    isImportedMaterialReviewNote(note) ||
    /\b(entries were extracted|was extracted|were extracted|classified as|present.*preserved|preserved exactly)\b/.test(
      normalized,
    )
  ) {
    return {
      confidence: "high",
      expectedAction: "acknowledge",
      noteKind: "observation",
      reason: baseReason,
      targetField: inferProfileTargetField(normalized),
    };
  }

  return {
    confidence: "medium",
    expectedAction: "review_import",
    noteKind: "import_review",
    reason: baseReason,
    targetField: inferProfileTargetField(normalized),
  };
}

function looksLikeConcreteExtractionGap(normalized: string) {
  return (
    /\b(add|provide|what|which|how|why|quantify|clarify|describe)\b/.test(normalized) &&
    /\b(metric|impact|ownership|technical|mechanism|scope|stakeholder|result|activation|latency|revenue|cost|scale)\b/.test(
      normalized,
    )
  );
}

function looksLikeStoryGap(normalized: string) {
  return /\b(story|project|initiative|role|ownership|technical mechanism|scope)\b/.test(normalized);
}

function inferProfileTargetField(normalized: string) {
  if (/\bcertification/.test(normalized)) return "certifications";
  if (/\beducation/.test(normalized)) return "education";
  if (/\bcontact|email|phone|linkedin/.test(normalized)) return "contact";
  if (/\bskills?/.test(normalized)) return "skills";
  if (/\blocation/.test(normalized)) return "location";
  if (/\bpresent|end date/.test(normalized)) return "end_date";
  return null;
}

function inferRoleTargetField(normalized: string) {
  if (/\b(location was not|does not state a location|no location|location missing|role location|work location)\b/.test(normalized)) {
    return "location";
  }
  if (/\b(team was not|does not state a team|no team|team missing|department missing|group missing|team\/department)\b/.test(normalized)) {
    return "team";
  }
  if (/\b(start date was not|does not state a start date|no start date|start date missing|started date|begin date)\b/.test(normalized)) {
    return "start_date";
  }
  if (/\b(end date was not|does not state an end date|does not state a clear end date|no end date|end date missing|present preserved|stated as present|end date is present|current role)\b/.test(normalized)) {
    return "end_date";
  }
  if (/\b(summary was not|does not state a summary|no summary|summary missing|role summary|role description missing|description missing)\b/.test(normalized)) {
    return "summary";
  }
  return null;
}

function looksLikeRoleFieldNote(normalized: string) {
  return /\b(work experience|role|employer|company|internship|job|position|experience line|employment|role line|work line)\b/.test(
    normalized,
  );
}

export async function updateEnrichmentTask(args: {
  taskId: string;
  action:
    | "answer"
    | "save_profile_context"
    | "acknowledge"
    | "dismiss"
    | "mark_import_reviewed"
    | "request_rerun"
    | "convert_to_enrichment_question"
    | "reopen"
    | "convert"
    | "accept_suggested_target"
    | "reject_suggested_target"
    | "choose_different_target"
    | "change_workflow_route"
    | "create_story_target"
    | "link"
    | "accept_proposal"
    | "reject_proposal"
    | "revise_proposal";
  userAnswer?: string;
  anchor?: ReusableLibraryAnchor;
  storyTarget?: EnrichmentStoryTargetCreation;
  proposalId?: string;
  route?: "create_evidence" | "update_evidence" | "update_story" | "update_role" | "profile_context";
  targetId?: string;
  revisedText?: string;
  revisionInstruction?: string;
  useAiExtraction?: boolean;
  extractAnswerEvidence?: (args: {
    sourceId: string;
    sourceText: string;
  }) => Promise<EnrichmentAnswerExtractorResult | null>;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(enrichmentTasks)
    .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)))
    .limit(1);
  if (!existing) return { status: "not_found" as const };

  if (args.action === "convert") {
    const directConvertAllowed = await canUseLegacyConvert(db, {
      workspaceId: workspace.id,
      taskId: existing.id,
    });
    if (!directConvertAllowed) {
      return { status: "invalid" as const, reason: "proposal_review_required" as const };
    }
    return convertEnrichmentTaskToEvidenceCandidate(db, {
      task: existing,
      now,
      useAiExtraction: args.useAiExtraction ?? false,
      extractAnswerEvidence: args.extractAnswerEvidence,
    });
  }

  if (args.action === "accept_proposal") {
    if (!args.proposalId) {
      return { status: "invalid" as const, reason: "missing_proposal_id" as const };
    }
    return acceptEnrichmentProposal(db, {
      task: existing,
      proposalId: args.proposalId,
      now,
    });
  }

  if (args.action === "reject_proposal") {
    if (!args.proposalId) {
      return { status: "invalid" as const, reason: "missing_proposal_id" as const };
    }
    return rejectEnrichmentProposal(db, {
      task: existing,
      proposalId: args.proposalId,
      now,
    });
  }

  if (args.action === "revise_proposal") {
    if (!args.proposalId) {
      return { status: "invalid" as const, reason: "missing_proposal_id" as const };
    }
    return reviseEnrichmentProposal(db, {
      task: existing,
      proposalId: args.proposalId,
      revisedText: args.revisedText,
      revisionInstruction: args.revisionInstruction,
      now,
    });
  }

  if (args.action === "accept_suggested_target") {
    if (!args.targetId) {
      return { status: "invalid" as const, reason: "missing_target_id" as const };
    }
    return acceptSuggestedTarget(db, {
      now,
      targetId: args.targetId,
      task: existing,
      workspaceId: workspace.id,
    });
  }

  if (args.action === "reject_suggested_target") {
    if (!args.targetId) {
      return { status: "invalid" as const, reason: "missing_target_id" as const };
    }
    return rejectSuggestedTarget(db, {
      now,
      targetId: args.targetId,
      task: existing,
      workspaceId: workspace.id,
    });
  }

  if (args.action === "choose_different_target") {
    return clearConfirmedTaskTarget(db, {
      now,
      task: existing,
      workspaceId: workspace.id,
    });
  }

  if (args.action === "change_workflow_route") {
    if (!args.route) {
      return { status: "invalid" as const, reason: "missing_workflow_route" as const };
    }
    return changeWorkflowRoute(db, {
      now,
      route: args.route,
      task: existing,
      workspaceId: workspace.id,
    });
  }

  if (args.action === "create_story_target") {
    if (!args.storyTarget) {
      return { status: "invalid" as const, reason: "missing_story_target" as const };
    }
    return createStoryTargetForTask(db, {
      now,
      storyTarget: args.storyTarget,
      task: existing,
      workspaceId: workspace.id,
    });
  }

  const patch: Partial<typeof enrichmentTasks.$inferInsert> = {
    updatedAt: now,
  };
  if (args.action === "answer" || args.action === "save_profile_context") {
    const answer = args.userAnswer?.trim();
    if (!answer) return { status: "invalid" as const, reason: "missing_answer" as const };
    if (args.action === "save_profile_context" && !canSaveProfileContextRoute(existing)) {
      return { status: "invalid" as const, reason: "unsupported_profile_context_route" as const };
    }
    patch.status = "answered";
    patch.userAnswer = answer;
    patch.answeredAt = now;
    patch.dismissedAt = null;
    if (args.action === "save_profile_context" || shouldSaveProfileContextAnswer(existing)) {
      patch.status = "converted";
      patch.convertedAt = now;
      patch.resolvedAt = now;
      patch.resolutionKind = "profile_answer_saved";
      patch.targetScope = "profile_context";
      patch.expectedOutcome = "save_profile_answer";
      patch.targetConfidence = "low";
      patch.targetReason = "User chose to save this answer as profile context.";
      patch.evidenceItemId = null;
      patch.workExperienceId = null;
      patch.initiativeId = null;
      patch.portfolioProjectId = null;
      await rejectPendingProposals(db, {
        workspaceId: workspace.id,
        taskId: existing.id,
        now,
      });
      await saveProfileContextAnswer(db, {
        answer,
        now,
        task: existing,
      });
    }
  } else if (args.action === "acknowledge") {
    if (!canAcknowledgeEnrichmentTask(existing)) {
      return { status: "invalid" as const, reason: "unsupported_acknowledge_action" as const };
    }
    patch.status = "converted";
    patch.acknowledgedAt = now;
    patch.resolvedAt = now;
    patch.resolutionKind = "acknowledged";
    patch.convertedAt = now;
  } else if (args.action === "dismiss") {
    patch.status = "dismissed";
    patch.dismissedAt = now;
    patch.resolvedAt = now;
    patch.resolutionKind = "dismissed";
  } else if (args.action === "mark_import_reviewed") {
    if (!canResolveImportedNote(existing)) {
      return { status: "invalid" as const, reason: "unsupported_import_review_action" as const };
    }
    patch.status = "converted";
    patch.resolvedAt = now;
    patch.resolutionKind = "import_reviewed";
    patch.convertedAt = now;
  } else if (args.action === "request_rerun") {
    if (!canResolveImportedNote(existing)) {
      return { status: "invalid" as const, reason: "unsupported_rerun_action" as const };
    }
    patch.status = "converted";
    patch.resolvedAt = now;
    patch.resolutionKind = "rerun_requested";
    patch.convertedAt = now;
  } else if (args.action === "convert_to_enrichment_question") {
    if (!canResolveImportedNote(existing)) {
      return { status: "invalid" as const, reason: "unsupported_convert_note_action" as const };
    }
    patch.status = "open";
    patch.taskType = classifyEnrichmentTaskAsQuestion(existing.prompt);
    patch.targetScope = "assign_later";
    patch.targetConfidence = "low";
    patch.targetReason =
      "Converted from an imported material note. Choose a target before saving reusable evidence.";
    patch.expectedOutcome = "route_answer";
    patch.noteKind = null;
    patch.expectedAction = null;
    patch.targetField = null;
    patch.resolvedAt = null;
    patch.resolutionKind = null;
    patch.convertedAt = null;
    patch.acknowledgedAt = null;
    patch.dismissedAt = null;
  } else if (args.action === "reopen") {
    patch.status = existing.userAnswer ? "answered" : "open";
    patch.dismissedAt = null;
    patch.acknowledgedAt = null;
    patch.resolvedAt = null;
    patch.resolutionKind = null;
  } else if (args.action === "link") {
    const anchor = await validateReusableLibraryAnchor(db, {
      anchor: args.anchor ?? {},
      workspaceId: workspace.id,
    });
    if (anchor.status === "invalid") {
      return { status: "invalid" as const, reason: anchor.reason };
    }
    patch.evidenceItemId = anchor.anchor.evidenceItemId ?? null;
    patch.workExperienceId = anchor.anchor.workExperienceId ?? null;
    patch.initiativeId = anchor.anchor.initiativeId ?? null;
    patch.portfolioProjectId = anchor.anchor.portfolioProjectId ?? null;
    Object.assign(
      patch,
      deriveTaskTargetMetadata(anchor.anchor, "User selected this destination."),
    );
    await rejectPendingProposals(db, {
      workspaceId: workspace.id,
      taskId: existing.id,
      now,
    });
  }

  const updateResult =
    args.action === "answer" && !shouldSaveProfileContextAnswer(existing)
      ? await saveAnswerAndCreateProposal(db, {
          workspaceId: workspace.id,
          taskId: args.taskId,
          patch,
          now,
        })
      : await updateTaskPatch(db, {
          workspaceId: workspace.id,
          taskId: args.taskId,
          patch,
        });
  const updated = updateResult?.updated;
  if (updated && args.action === "save_profile_context") {
    await db
      .delete(enrichmentTaskTargets)
      .where(
        and(
          eq(enrichmentTaskTargets.workspaceId, workspace.id),
          eq(enrichmentTaskTargets.taskId, updated.id),
        ),
      );
  }
  if (updated && updateResult?.targetRequired) {
    const targetMap = await getTaskTargetMap(db, [updated.id]);
    const proposalMap = await getTaskProposalMap(db, [updated.id]);
    const revisionMap = await getTaskProposalRevisionMap(db, [updated.id]);
    return {
      status: "invalid" as const,
      reason: "target_required" as const,
      task: toEnrichmentTaskPayload(
        updated,
        targetMap.get(updated.id),
        proposalMap.get(updated.id),
        revisionMap.get(updated.id),
      ),
    };
  }
  if (updated && updateResult?.targetConfirmationRequired) {
    const targetMap = await getTaskTargetMap(db, [updated.id]);
    const proposalMap = await getTaskProposalMap(db, [updated.id]);
    const revisionMap = await getTaskProposalRevisionMap(db, [updated.id]);
    return {
      status: "invalid" as const,
      reason: "target_confirmation_required" as const,
      task: toEnrichmentTaskPayload(
        updated,
        targetMap.get(updated.id),
        proposalMap.get(updated.id),
        revisionMap.get(updated.id),
      ),
    };
  }
  if (updated && args.action === "link") {
    await replaceTaskTargets(db, {
      workspaceId: workspace.id,
      taskId: updated.id,
      anchor: {
        evidenceItemId: updated.evidenceItemId,
        workExperienceId: updated.workExperienceId,
        initiativeId: updated.initiativeId,
        portfolioProjectId: updated.portfolioProjectId,
      },
      reason: "User selected this destination.",
      confidence: "high",
    });
    const answer = updated.userAnswer?.trim();
    if (answer && shouldCreateProposalForTask(updated)) {
      const targetValidation = await validateTargetForProposalGeneration(db, updated);
      if (targetValidation.status === "target_required") {
        const targetMap = await getTaskTargetMap(db, [updated.id]);
        const proposalMap = await getTaskProposalMap(db, [updated.id]);
        const revisionMap = await getTaskProposalRevisionMap(db, [updated.id]);
        return {
          status: "invalid" as const,
          reason: "target_required" as const,
          task: toEnrichmentTaskPayload(
            updated,
            targetMap.get(updated.id),
            proposalMap.get(updated.id),
            revisionMap.get(updated.id),
          ),
        };
      }
      if (targetValidation.status === "target_confirmation_required") {
        const targetMap = await getTaskTargetMap(db, [updated.id]);
        const proposalMap = await getTaskProposalMap(db, [updated.id]);
        const revisionMap = await getTaskProposalRevisionMap(db, [updated.id]);
        return {
          status: "invalid" as const,
          reason: "target_confirmation_required" as const,
          task: toEnrichmentTaskPayload(
            updated,
            targetMap.get(updated.id),
            proposalMap.get(updated.id),
            revisionMap.get(updated.id),
          ),
        };
      }
      const proposalDraft = await buildAndEnhanceEnrichmentProposalDraft(db, {
        answer,
        task: updated,
      });
      await createPendingProposalForAnswer(db, {
        proposalDraft,
        task: updated,
        answer,
        now,
      });
    }
  }
  const targetMap = updated ? await getTaskTargetMap(db, [updated.id]) : new Map();
  const proposalMap = updated ? await getTaskProposalMap(db, [updated.id]) : new Map();
  const revisionMap = updated ? await getTaskProposalRevisionMap(db, [updated.id]) : new Map();
  return updated
    ? ({
        status: "saved" as const,
        task: toEnrichmentTaskPayload(
          updated,
          targetMap.get(updated.id),
          proposalMap.get(updated.id),
          revisionMap.get(updated.id),
        ),
      })
    : ({ status: "not_found" as const });
}

async function saveProfileContextAnswer(
  db: Pick<DbHandle, "insert" | "update">,
  args: {
    answer: string;
    now: Date;
    task: typeof enrichmentTasks.$inferSelect;
  },
) {
  const [answerRow] = await db
    .insert(enrichmentAnswers)
    .values({
      workspaceId: args.task.workspaceId,
      taskId: args.task.id,
      answerText: args.answer,
      answerStatus: "applied",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning({ id: enrichmentAnswers.id });
  if (!answerRow) throw new Error("Failed to save profile context answer.");
  await db
    .update(profileContextAnswers)
    .set({
      status: "archived",
      updatedAt: args.now,
    })
    .where(
      and(
        eq(profileContextAnswers.workspaceId, args.task.workspaceId),
        eq(profileContextAnswers.sourceTaskId, args.task.id),
        eq(profileContextAnswers.status, "active"),
      ),
    );
  await db.insert(profileContextAnswers).values({
    workspaceId: args.task.workspaceId,
    sourceTaskId: args.task.id,
    sourceAnswerId: answerRow.id,
    contextType: inferProfileContextType(args.task.prompt, args.answer),
    answerText: args.answer,
    normalizedTags: normalizeProfileContextTags(args.task.prompt, args.answer),
    status: "active",
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function acceptSuggestedTarget(
  db: DbHandle,
  args: {
    now: Date;
    targetId: string;
    task: typeof enrichmentTasks.$inferSelect;
    workspaceId: string;
  },
) {
  const [target] = await db
    .select()
    .from(enrichmentTaskTargets)
    .where(
      and(
        eq(enrichmentTaskTargets.workspaceId, args.workspaceId),
        eq(enrichmentTaskTargets.taskId, args.task.id),
        eq(enrichmentTaskTargets.targetId, args.targetId),
        eq(enrichmentTaskTargets.targetRole, "suggested"),
        sql`${enrichmentTaskTargets.rejectedAt} is null`,
      ),
    )
    .limit(1);
  if (!target) {
    return { status: "invalid" as const, reason: "suggested_target_not_found" as const };
  }
  const anchor = anchorFromTargetRow(target);
  const patch: Partial<typeof enrichmentTasks.$inferInsert> = {
    evidenceItemId: anchor.evidenceItemId ?? null,
    initiativeId: anchor.initiativeId ?? null,
    portfolioProjectId: anchor.portfolioProjectId ?? null,
    workExperienceId: anchor.workExperienceId ?? null,
    updatedAt: args.now,
    ...deriveTaskTargetMetadata(anchor, "User accepted a suggested destination."),
  };
  await rejectPendingProposals(db, {
    workspaceId: args.workspaceId,
    taskId: args.task.id,
    now: args.now,
  });
  const [updated] = await db
    .update(enrichmentTasks)
    .set(patch)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.id, args.task.id),
      ),
    )
    .returning();
  if (!updated) return { status: "not_found" as const };
  await db
    .update(enrichmentTaskTargets)
    .set({
      targetRole: "primary",
      acceptedAt: args.now,
      createdBy: "user",
      updatedAt: args.now,
    })
    .where(eq(enrichmentTaskTargets.id, target.id));
  await db
    .update(enrichmentTaskTargets)
    .set({
      rejectedAt: args.now,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentTaskTargets.workspaceId, args.workspaceId),
        eq(enrichmentTaskTargets.taskId, args.task.id),
        eq(enrichmentTaskTargets.targetRole, "suggested"),
        sql`${enrichmentTaskTargets.id} <> ${target.id}`,
      ),
    );
  const answer = updated.userAnswer?.trim();
  if (answer && shouldCreateProposalForTask(updated)) {
    const targetValidation = await validateTargetForProposalGeneration(db, updated);
    if (targetValidation.status !== "ready") {
      return taskUpdateInvalidPayload(db, {
        reason: targetValidation.status,
        task: updated,
      });
    }
    const proposalDraft = await buildAndEnhanceEnrichmentProposalDraft(db, {
      answer,
      task: updated,
    });
    await createPendingProposalForAnswer(db, {
      answer,
      now: args.now,
      proposalDraft,
      task: updated,
    });
  }
  return taskUpdateSavedPayload(db, updated);
}

async function rejectSuggestedTarget(
  db: DbHandle,
  args: {
    now: Date;
    targetId: string;
    task: typeof enrichmentTasks.$inferSelect;
    workspaceId: string;
  },
) {
  const [updatedTarget] = await db
    .update(enrichmentTaskTargets)
    .set({
      rejectedAt: args.now,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentTaskTargets.workspaceId, args.workspaceId),
        eq(enrichmentTaskTargets.taskId, args.task.id),
        eq(enrichmentTaskTargets.targetId, args.targetId),
        eq(enrichmentTaskTargets.targetRole, "suggested"),
      ),
    )
    .returning();
  if (!updatedTarget) {
    return { status: "invalid" as const, reason: "suggested_target_not_found" as const };
  }
  return taskUpdateSavedPayload(db, args.task);
}

async function clearConfirmedTaskTarget(
  db: DbHandle,
  args: {
    now: Date;
    task: typeof enrichmentTasks.$inferSelect;
    workspaceId: string;
  },
) {
  await rejectPendingProposals(db, {
    workspaceId: args.workspaceId,
    taskId: args.task.id,
    now: args.now,
  });
  const [updated] = await db
    .update(enrichmentTasks)
    .set({
      evidenceItemId: null,
      initiativeId: null,
      portfolioProjectId: null,
      workExperienceId: null,
      targetScope: "assign_later",
      targetConfidence: "low",
      targetReason: "User chose a different target or workflow.",
      expectedOutcome: "route_answer",
      updatedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.id, args.task.id),
      ),
    )
    .returning();
  if (!updated) return { status: "not_found" as const };
  await db
    .update(enrichmentTaskTargets)
    .set({
      targetRole: "previous",
      updatedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentTaskTargets.workspaceId, args.workspaceId),
        eq(enrichmentTaskTargets.taskId, args.task.id),
        eq(enrichmentTaskTargets.targetRole, "primary"),
      ),
    );
  return taskUpdateSavedPayload(db, updated);
}

async function changeWorkflowRoute(
  db: DbHandle,
  args: {
    now: Date;
    route: "create_evidence" | "update_evidence" | "update_story" | "update_role" | "profile_context";
    task: typeof enrichmentTasks.$inferSelect;
    workspaceId: string;
  },
) {
  if (args.route === "profile_context") {
    await rejectPendingProposals(db, {
      workspaceId: args.workspaceId,
      taskId: args.task.id,
      now: args.now,
    });
    const [updated] = await db
      .update(enrichmentTasks)
      .set({
        evidenceItemId: null,
        initiativeId: null,
        portfolioProjectId: null,
        workExperienceId: null,
        targetScope: "profile_context",
        expectedOutcome: "save_profile_answer",
        targetConfidence: "low",
        targetReason: "User chose to save this as profile context.",
        updatedAt: args.now,
      })
      .where(
        and(
          eq(enrichmentTasks.workspaceId, args.workspaceId),
          eq(enrichmentTasks.id, args.task.id),
        ),
      )
      .returning();
    if (!updated) return { status: "not_found" as const };
    await db
      .delete(enrichmentTaskTargets)
      .where(
        and(
          eq(enrichmentTaskTargets.workspaceId, args.workspaceId),
          eq(enrichmentTaskTargets.taskId, args.task.id),
        ),
      );
    return taskUpdateSavedPayload(db, updated);
  }
  const routeMetadata = workflowRouteMetadata(args.route);
  const preservedAnchor =
    args.route === "create_evidence" && (args.task.initiativeId || args.task.portfolioProjectId)
      ? {
          initiativeId: args.task.initiativeId,
          portfolioProjectId: args.task.portfolioProjectId,
          workExperienceId: args.task.workExperienceId,
        }
      : {
          initiativeId: null,
          portfolioProjectId: null,
          workExperienceId: null,
        };
  const [updated] = await db
    .update(enrichmentTasks)
    .set({
      evidenceItemId: null,
      ...preservedAnchor,
      ...routeMetadata,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.id, args.task.id),
      ),
    )
    .returning();
  if (!updated) return { status: "not_found" as const };
  await rejectPendingProposals(db, {
    workspaceId: args.workspaceId,
    taskId: args.task.id,
    now: args.now,
  });
  await db
    .update(enrichmentTaskTargets)
    .set({
      targetRole: "previous",
      updatedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentTaskTargets.workspaceId, args.workspaceId),
        eq(enrichmentTaskTargets.taskId, args.task.id),
        eq(enrichmentTaskTargets.targetRole, "primary"),
      ),
    );
  if (updated.initiativeId || updated.portfolioProjectId || updated.workExperienceId) {
    await replaceTaskTargets(db, {
      workspaceId: args.workspaceId,
      taskId: updated.id,
      anchor: {
        initiativeId: updated.initiativeId,
        portfolioProjectId: updated.portfolioProjectId,
        workExperienceId: updated.workExperienceId,
      },
      reason: "User chose to create evidence for this Story Target.",
      confidence: "high",
      createdBy: "user",
    });
  }
  return taskUpdateSavedPayload(db, updated);
}

async function taskUpdateSavedPayload(
  db: DbHandle,
  task: typeof enrichmentTasks.$inferSelect,
) {
  const targetMap = await getTaskTargetMap(db, [task.id]);
  const proposalMap = await getTaskProposalMap(db, [task.id]);
  const revisionMap = await getTaskProposalRevisionMap(db, [task.id]);
  return {
    status: "saved" as const,
    task: toEnrichmentTaskPayload(
      task,
      targetMap.get(task.id),
      proposalMap.get(task.id),
      revisionMap.get(task.id),
    ),
  };
}

async function taskUpdateInvalidPayload(
  db: DbHandle,
  args: {
    reason: "target_required" | "target_confirmation_required";
    task: typeof enrichmentTasks.$inferSelect;
  },
) {
  const targetMap = await getTaskTargetMap(db, [args.task.id]);
  const proposalMap = await getTaskProposalMap(db, [args.task.id]);
  const revisionMap = await getTaskProposalRevisionMap(db, [args.task.id]);
  return {
    status: "invalid" as const,
    reason: args.reason,
    task: toEnrichmentTaskPayload(
      args.task,
      targetMap.get(args.task.id),
      proposalMap.get(args.task.id),
      revisionMap.get(args.task.id),
    ),
  };
}

function anchorFromTargetRow(
  target: typeof enrichmentTaskTargets.$inferSelect,
): ReusableLibraryAnchor {
  return {
    evidenceItemId: target.targetKind === "evidence" ? target.targetId : null,
    initiativeId: target.targetKind === "initiative" ? target.targetId : null,
    portfolioProjectId: target.targetKind === "portfolio_project" ? target.targetId : null,
    workExperienceId: target.targetKind === "work_experience" ? target.targetId : null,
  };
}

function workflowRouteMetadata(
  route: "create_evidence" | "update_evidence" | "update_story" | "update_role",
): Partial<typeof enrichmentTasks.$inferInsert> {
  if (route === "create_evidence") {
    return {
      expectedOutcome: "create_evidence",
      targetConfidence: "low",
      targetReason: "User chose to create a new evidence card.",
      targetScope: "assign_later",
    };
  }
  if (route === "update_evidence") {
    return {
      expectedOutcome: "update_evidence",
      targetConfidence: "low",
      targetReason: "User chose to update an existing evidence claim.",
      targetScope: "evidence_detail",
    };
  }
  if (route === "update_story") {
    return {
      expectedOutcome: "update_story",
      targetConfidence: "low",
      targetReason: "User chose to attach this answer to a story.",
      targetScope: "story_context",
    };
  }
  return {
    expectedOutcome: "update_role",
    targetConfidence: "low",
    targetReason: "User chose to attach this answer to a role.",
    targetScope: "role_context",
  };
}

export async function reconcileResumeReviewEnrichmentTasksForSource(
  db: Pick<DbHandle, "delete" | "insert" | "select" | "update">,
  args: {
    workspaceId: string;
    resumeSourceVersionId: string;
    anchors: Array<
      ReusableLibraryAnchor & {
        text: string;
        sourceQuote?: string | null;
      }
    >;
    now?: Date;
  },
) {
  const cleanAnchors = args.anchors.filter(hasReusableLibraryAnchor);
  if (cleanAnchors.length === 0) return { updatedCount: 0 };
  const now = args.now ?? new Date();
  const tasks = await db
    .select()
    .from(enrichmentTasks)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.sourceType, "resume_review"),
        eq(enrichmentTasks.resumeSourceVersionId, args.resumeSourceVersionId),
        inArray(enrichmentTasks.status, ["open", "answered"]),
        sql`${enrichmentTasks.evidenceItemId} is null`,
        sql`${enrichmentTasks.workExperienceId} is null`,
        sql`${enrichmentTasks.initiativeId} is null`,
        sql`${enrichmentTasks.portfolioProjectId} is null`,
      ),
    );

  let updatedCount = 0;
  for (const task of tasks) {
    if (isBroadProfilePositioningQuestion(task.prompt)) continue;
    const anchor = pickBestAnchorForTask(task.prompt, cleanAnchors);
    if (!anchor) continue;
    await replaceTaskTargets(db, {
      workspaceId: args.workspaceId,
      taskId: task.id,
      anchor,
      reason: "Suggested from material imported from the same source. Confirm before using it.",
      confidence: "medium",
      createdBy: "system",
      targetRole: "suggested",
    });
    updatedCount += 1;
  }
  return { updatedCount };
}

async function convertEnrichmentTaskToEvidenceCandidate(
  db: DbHandle,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    now: Date;
    useAiExtraction: boolean;
    extractAnswerEvidence?: (args: {
      sourceId: string;
      sourceText: string;
    }) => Promise<EnrichmentAnswerExtractorResult | null>;
  },
) {
  if (!args.task.userAnswer?.trim()) {
    return { status: "invalid" as const, reason: "missing_answer" as const };
  }
  if (args.task.status === "converted" && args.task.evidenceItemId) {
    const targetMap = await getTaskTargetMap(db, [args.task.id]);
    const proposalMap = await getTaskProposalMap(db, [args.task.id]);
    const revisionMap = await getTaskProposalRevisionMap(db, [args.task.id]);
    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(
        args.task,
        targetMap.get(args.task.id),
        proposalMap.get(args.task.id),
        revisionMap.get(args.task.id),
      ),
      evidenceItemId: args.task.evidenceItemId,
    };
  }

  const content = args.task.userAnswer?.trim() ?? "";
  const aiExtraction = args.useAiExtraction
    ? await (args.extractAnswerEvidence ?? extractEnrichmentAnswerEvidence)({
        sourceId: args.task.id,
        sourceText: content,
      })
    : null;

  return db.transaction(async (tx) => {
    const [sourceDocument] = await tx
      .insert(sourceDocuments)
      .values({
        workspaceId: args.task.workspaceId,
        sourceType: "enrichment-answer",
        title: `Enrichment answer: ${args.task.sourceLabel}`,
        contentText: content,
        contentHash: crypto.createHash("sha256").update(content).digest("hex"),
        createdAt: args.now,
      })
      .returning({ id: sourceDocuments.id });
    if (!sourceDocument) {
      throw new Error("Failed to create enrichment answer source document.");
    }

    const evidenceDrafts = aiExtraction?.extraction.evidence_items.length
      ? aiExtraction.extraction.evidence_items
      : [buildFallbackEvidenceDraft(content)];
    const insertedEvidence = await tx
      .insert(evidenceItems)
      .values(
        evidenceDrafts.map((item) => {
          const guardrail = evaluateEnrichmentEvidenceGuardrails(item, content);
          return {
          workspaceId: args.task.workspaceId,
          sourceDocumentId: sourceDocument.id,
          text: item.text,
          sourceQuote: item.source_quote,
          evidenceType: item.evidence_type,
          metrics: guardrail.metrics,
          sensitivityLevel: item.sensitivity_level,
          allowedUsage: item.allowed_usage,
          publicSafeSummary: item.public_safe_summary,
          status: item.status,
          ...buildEvidenceRelationForTask(args.task),
          needsUserConfirmation: guardrail.needsUserConfirmation ? 1 : 0,
          createdAt: args.now,
          updatedAt: args.now,
          };
        }),
      )
      .returning({ id: evidenceItems.id });
    if (insertedEvidence.length === 0) {
      throw new Error("Failed to create evidence from enrichment answer.");
    }

    if (aiExtraction) {
      await tx.insert(workflowRuns).values({
        workspaceId: args.task.workspaceId,
        workflowType: "profile-evidence-extraction",
        status: "succeeded",
        provider: aiExtraction.provider,
        model: aiExtraction.model,
        ...workflowSkillFields(aiExtraction.skill),
        inputTokens: aiExtraction.usage.inputTokens ?? null,
        outputTokens: aiExtraction.usage.outputTokens ?? null,
        totalTokens: aiExtraction.usage.totalTokens ?? null,
        retryCount: aiExtraction.retryCount,
        startedAt: args.now,
        finishedAt: args.now,
      });
    }

    const [updated] = await tx
      .update(enrichmentTasks)
      .set({
        status: "converted",
        evidenceItemId: insertedEvidence[0]?.id ?? null,
        updatedAt: args.now,
        convertedAt: args.now,
      })
      .where(and(eq(enrichmentTasks.workspaceId, args.task.workspaceId), eq(enrichmentTasks.id, args.task.id)))
      .returning();
    if (!updated) throw new Error("Failed to mark enrichment task converted.");
    await tx
      .update(enrichmentProposals)
      .set({
        status: "rejected",
        updatedAt: args.now,
        reviewedAt: args.now,
      })
      .where(
        and(
          eq(enrichmentProposals.workspaceId, args.task.workspaceId),
          eq(enrichmentProposals.taskId, args.task.id),
          eq(enrichmentProposals.status, "pending_review"),
        ),
      );
    await replaceTaskTargets(tx, {
      workspaceId: args.task.workspaceId,
      taskId: updated.id,
      anchor: {
        evidenceItemId: updated.evidenceItemId,
        workExperienceId: updated.workExperienceId,
        initiativeId: updated.initiativeId,
        portfolioProjectId: updated.portfolioProjectId,
      },
      reason: "Converted answer created this evidence candidate.",
      confidence: "medium",
    });
    const targetMap = await getTaskTargetMap(tx, [updated.id]);
    const proposalMap = await getTaskProposalMap(tx, [updated.id]);
    const revisionMap = await getTaskProposalRevisionMap(tx, [updated.id]);

    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(
        updated,
        targetMap.get(updated.id),
        proposalMap.get(updated.id),
        revisionMap.get(updated.id),
      ),
      evidenceItemId: insertedEvidence[0]?.id ?? null,
      evidenceCount: insertedEvidence.length,
      conversionMode: aiExtraction ? "ai_extraction" as const : "fallback" as const,
    };
  });
}

async function createPendingProposalForAnswer(
  db: Pick<DbHandle, "insert" | "select" | "update">,
  args: {
    proposalDraft: EnrichmentProposalDraft;
    task: typeof enrichmentTasks.$inferSelect;
    answer: string;
    now: Date;
  },
) {
  const answer = args.answer.trim();
  if (!answer) return null;
  await db
    .update(enrichmentProposals)
    .set({
      status: "rejected",
      updatedAt: args.now,
      reviewedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentProposals.workspaceId, args.task.workspaceId),
        eq(enrichmentProposals.taskId, args.task.id),
        eq(enrichmentProposals.status, "pending_review"),
      ),
    );
  const [answerRow] = await db
    .insert(enrichmentAnswers)
    .values({
      workspaceId: args.task.workspaceId,
      taskId: args.task.id,
      answerText: answer,
      answerStatus: "submitted",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning({ id: enrichmentAnswers.id });
  if (!answerRow) throw new Error("Failed to save enrichment answer.");
  const [proposal] = await db
    .insert(enrichmentProposals)
    .values({
      workspaceId: args.task.workspaceId,
      taskId: args.task.id,
      answerId: answerRow.id,
      proposalType: args.proposalDraft.proposalType,
      targetKind: args.proposalDraft.targetKind,
      targetId: args.proposalDraft.targetId,
      proposedPatchJson: args.proposalDraft.patch,
      evidenceDeltaJson: {
        text: getProposalPatchPreviewText(args.proposalDraft.patch),
        target_summary: summarizeProposalTarget(args.task),
        resume_safe_note: args.proposalDraft.nextStepNote,
      },
      schemaVersion: "enrichment-proposal-v1",
      status: "pending_review",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .returning();
  return proposal ?? null;
}

async function saveAnswerAndCreateProposal(
  db: DbHandle,
  args: {
    workspaceId: string;
    taskId: string;
    patch: Partial<typeof enrichmentTasks.$inferInsert>;
    now: Date;
  },
) {
  const [existingTask] = await db
    .select()
    .from(enrichmentTasks)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.id, args.taskId),
      ),
    )
    .limit(1);
  if (!existingTask) return undefined;
  const answer = typeof args.patch.userAnswer === "string" ? args.patch.userAnswer.trim() : "";
  const proposalTask = {
    ...existingTask,
    ...args.patch,
    userAnswer: answer,
  };
  const targetValidation =
    answer && shouldCreateProposalForTask(proposalTask)
      ? await validateTargetForProposalGeneration(db, proposalTask)
      : { status: "ready" as const };
  const proposalDraft = answer
    ? shouldCreateProposalForTask(proposalTask)
      ? targetValidation.status === "target_required" ||
        targetValidation.status === "target_confirmation_required"
        ? targetValidation.status
        : await buildAndEnhanceEnrichmentProposalDraft(db, {
          answer,
          task: proposalTask,
        })
      : null
    : null;
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(enrichmentTasks)
      .set(args.patch)
      .where(
        and(
          eq(enrichmentTasks.workspaceId, args.workspaceId),
          eq(enrichmentTasks.id, args.taskId),
        ),
      )
      .returning();
    if (!updated) return undefined;
    if (proposalDraft === "target_required") {
      return { targetConfirmationRequired: false, targetRequired: true, updated };
    }
    if (proposalDraft === "target_confirmation_required") {
      return { targetConfirmationRequired: true, targetRequired: false, updated };
    }
    if (proposalDraft) {
      await createPendingProposalForAnswer(tx, {
        proposalDraft,
        task: updated,
        answer: updated.userAnswer ?? "",
        now: args.now,
      });
    }
    return { targetConfirmationRequired: false, targetRequired: false, updated };
  });
}

async function updateTaskPatch(
  db: DbHandle,
  args: {
    workspaceId: string;
    taskId: string;
    patch: Partial<typeof enrichmentTasks.$inferInsert>;
  },
) {
  const [updated] = await db
    .update(enrichmentTasks)
    .set(args.patch)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.id, args.taskId),
      ),
    )
    .returning();
  return updated
    ? { targetConfirmationRequired: false, targetRequired: false, updated }
    : undefined;
}

async function createStoryTargetForTask(
  db: DbHandle,
  args: {
    workspaceId: string;
    task: typeof enrichmentTasks.$inferSelect;
    storyTarget: EnrichmentStoryTargetCreation;
    now: Date;
  },
) {
  if (!canCreateStoryTargetFromTask(args.task)) {
    return { status: "invalid" as const, reason: "unsupported_story_target_creation" as const };
  }
  const title = normalizeStoryTargetTitle(args.storyTarget.title);
  if (!title) {
    return { status: "invalid" as const, reason: "missing_story_target_title" as const };
  }
  if (args.storyTarget.targetType === "initiative" && !args.storyTarget.workExperienceId) {
    return { status: "invalid" as const, reason: "missing_work_experience" as const };
  }

  return db.transaction(async (tx) => {
    const context = buildStoryTargetCreationContext({
      prompt: args.task.prompt,
      sourceQuote: args.storyTarget.sourceQuote,
      userContext: args.storyTarget.context,
    });
    const problem = normalizeOptionalStoryField(args.storyTarget.problem);
    const role = normalizeOptionalStoryField(args.storyTarget.role);
    const actions = normalizeStoryFieldList(args.storyTarget.actions);
    const results = normalizeStoryFieldList(args.storyTarget.results);
    const technologies = normalizeStoryFieldList(args.storyTarget.technologies);
    const sourceDocumentId = await resolveTaskSourceDocumentId(tx, {
      resumeSourceVersionId: args.task.resumeSourceVersionId,
      workspaceId: args.workspaceId,
    });
    let anchor: ReusableLibraryAnchor;
    if (args.storyTarget.targetType === "initiative") {
      const [experience] = await tx
        .select({ id: workExperiences.id })
        .from(workExperiences)
        .where(
          and(
            eq(workExperiences.workspaceId, args.workspaceId),
            eq(workExperiences.id, args.storyTarget.workExperienceId ?? ""),
            sql`${workExperiences.status} <> 'rejected'`,
          ),
        )
        .limit(1);
      if (!experience) {
        return { status: "invalid" as const, reason: "work_experience_not_found" as const };
      }
      const [created] = await tx
        .insert(initiatives)
        .values({
          workspaceId: args.workspaceId,
          workExperienceId: experience.id,
          sourceDocumentId,
          internalTitle: title,
          context,
          problem,
          role,
          actions,
          results,
          technologies,
          status: "pending",
          createdAt: args.now,
          updatedAt: args.now,
        })
        .returning({ id: initiatives.id });
      if (!created) throw new Error("Failed to create enrichment story target.");
      anchor = {
        initiativeId: created.id,
        workExperienceId: experience.id,
      };
    } else {
      const [created] = await tx
        .insert(portfolioProjects)
        .values({
          workspaceId: args.workspaceId,
          sourceDocumentId,
          projectType: args.storyTarget.projectType ?? "general_project",
          title,
          context,
          problem,
          role,
          actions,
          results,
          technologies,
          status: "pending",
          createdAt: args.now,
          updatedAt: args.now,
        })
        .returning({ id: portfolioProjects.id });
      if (!created) throw new Error("Failed to create enrichment portfolio project.");
      anchor = {
        portfolioProjectId: created.id,
      };
    }

    await rejectPendingProposals(tx, {
      workspaceId: args.workspaceId,
      taskId: args.task.id,
      now: args.now,
    });
    const [updated] = await tx
      .update(enrichmentTasks)
      .set({
        evidenceItemId: null,
        workExperienceId: anchor.workExperienceId ?? null,
        initiativeId: anchor.initiativeId ?? null,
        portfolioProjectId: anchor.portfolioProjectId ?? null,
        targetScope: "story_context",
        targetConfidence: "high",
        targetReason: "User created this Story Target from the enrichment question.",
        expectedOutcome: "update_story",
        updatedAt: args.now,
      })
      .where(and(eq(enrichmentTasks.workspaceId, args.workspaceId), eq(enrichmentTasks.id, args.task.id)))
      .returning();
    if (!updated) return { status: "not_found" as const };
    await replaceTaskTargets(tx, {
      workspaceId: args.workspaceId,
      taskId: updated.id,
      anchor,
      reason: "User created this Story Target from the enrichment question.",
      confidence: "high",
      createdBy: "user",
    });
    const targetMap = await getTaskTargetMap(tx, [updated.id]);
    const proposalMap = await getTaskProposalMap(tx, [updated.id]);
    const revisionMap = await getTaskProposalRevisionMap(tx, [updated.id]);
    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(
        updated,
        targetMap.get(updated.id),
        proposalMap.get(updated.id),
        revisionMap.get(updated.id),
      ),
    };
  });
}

async function resolveTaskSourceDocumentId(
  db: Pick<DbHandle, "select">,
  args: {
    resumeSourceVersionId?: string | null;
    workspaceId: string;
  },
) {
  if (!args.resumeSourceVersionId) return null;
  const [resumeSource] = await db
    .select({ sourceDocumentId: resumeSourceVersions.sourceDocumentId })
    .from(resumeSourceVersions)
    .where(
      and(
        eq(resumeSourceVersions.workspaceId, args.workspaceId),
        eq(resumeSourceVersions.id, args.resumeSourceVersionId),
      ),
    )
    .limit(1);
  return resumeSource?.sourceDocumentId ?? null;
}

async function canUseLegacyConvert(
  db: Pick<DbHandle, "select">,
  args: {
    workspaceId: string;
    taskId: string;
  },
) {
  const rows = await db
    .select({ id: enrichmentProposals.id })
    .from(enrichmentProposals)
    .where(
      and(
        eq(enrichmentProposals.workspaceId, args.workspaceId),
        eq(enrichmentProposals.taskId, args.taskId),
        inArray(enrichmentProposals.status, ["pending_review", "accepted"]),
      ),
    )
    .limit(1);
  return rows.length === 0;
}

async function acceptEnrichmentProposal(
  db: DbHandle,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    proposalId: string;
    now: Date;
  },
) {
  return db.transaction(async (tx) => {
    const [pendingProposal] = await tx
      .select()
      .from(enrichmentProposals)
      .where(
        and(
          eq(enrichmentProposals.workspaceId, args.task.workspaceId),
          eq(enrichmentProposals.taskId, args.task.id),
          eq(enrichmentProposals.id, args.proposalId),
          eq(enrichmentProposals.status, "pending_review"),
        ),
      )
      .limit(1);
    if (!pendingProposal) {
      return { status: "invalid" as const, reason: "proposal_not_found" as const };
    }
    if (pendingProposal.proposalType !== "create_evidence") {
      if (!canAcceptGeneralEnrichmentProposal(pendingProposal.proposalType)) {
        return { status: "invalid" as const, reason: "unsupported_proposal_type" as const };
      }
      return acceptNonEvidenceEnrichmentProposal(tx, {
        now: args.now,
        proposal: pendingProposal,
        task: args.task,
      });
    }
    const patch = parseCreateEvidenceProposalPatch(pendingProposal.proposedPatchJson);
    if (!patch) {
      return { status: "invalid" as const, reason: "invalid_proposal_payload" as const };
    }
    const [proposal] = await tx
      .update(enrichmentProposals)
      .set({
        status: "accepted",
        updatedAt: args.now,
        reviewedAt: args.now,
      })
      .where(
        and(
          eq(enrichmentProposals.workspaceId, args.task.workspaceId),
          eq(enrichmentProposals.taskId, args.task.id),
          eq(enrichmentProposals.id, args.proposalId),
          eq(enrichmentProposals.status, "pending_review"),
        ),
      )
      .returning();
    if (!proposal) {
      return { status: "invalid" as const, reason: "proposal_not_found" as const };
    }
    const content = patch.source_quote || patch.text;
    const [sourceDocument] = await tx
      .insert(sourceDocuments)
      .values({
        workspaceId: args.task.workspaceId,
        sourceType: "enrichment-answer",
        title: `Enrichment answer: ${args.task.sourceLabel}`,
        contentText: content,
        contentHash: crypto.createHash("sha256").update(content).digest("hex"),
        createdAt: args.now,
      })
      .returning({ id: sourceDocuments.id });
    if (!sourceDocument) {
      throw new Error("Failed to create enrichment proposal source document.");
    }
    const [evidence] = await tx
      .insert(evidenceItems)
      .values({
        workspaceId: args.task.workspaceId,
        sourceDocumentId: sourceDocument.id,
        text: patch.text,
        sourceQuote: patch.source_quote,
        evidenceType: patch.evidence_type,
        metrics: patch.metrics,
        sensitivityLevel: patch.sensitivity_level,
        allowedUsage: patch.allowed_usage,
        publicSafeSummary: patch.public_safe_summary,
        status: patch.status,
        ...buildEvidenceRelationForAcceptedProposal(args.task, patch),
        needsUserConfirmation: patch.needs_user_confirmation ? 1 : 0,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .returning({ id: evidenceItems.id });
    if (!evidence) throw new Error("Failed to create evidence from proposal.");
    if (proposal.answerId) {
      await tx
        .update(enrichmentAnswers)
        .set({
          answerStatus: "applied",
          updatedAt: args.now,
        })
        .where(eq(enrichmentAnswers.id, proposal.answerId));
    }
    await tx
      .update(enrichmentProposals)
      .set({
        committedEvidenceItemId: evidence.id,
        updatedAt: args.now,
        reviewedAt: args.now,
      })
      .where(eq(enrichmentProposals.id, proposal.id));
    await tx
      .update(enrichmentProposals)
      .set({
        status: "rejected",
        updatedAt: args.now,
        reviewedAt: args.now,
      })
      .where(
        and(
          eq(enrichmentProposals.workspaceId, args.task.workspaceId),
          eq(enrichmentProposals.taskId, args.task.id),
          eq(enrichmentProposals.status, "pending_review"),
        ),
      );
    const [updated] = await tx
      .update(enrichmentTasks)
      .set({
        status: "converted",
        evidenceItemId: evidence.id,
        updatedAt: args.now,
        convertedAt: args.now,
      })
      .where(
        and(
          eq(enrichmentTasks.workspaceId, args.task.workspaceId),
          eq(enrichmentTasks.id, args.task.id),
        ),
      )
      .returning();
    if (!updated) throw new Error("Failed to mark enrichment task converted.");
    await replaceTaskTargets(tx, {
      workspaceId: args.task.workspaceId,
      taskId: updated.id,
      anchor: {
        evidenceItemId: evidence.id,
        initiativeId: updated.initiativeId,
        portfolioProjectId: updated.portfolioProjectId,
        workExperienceId: updated.workExperienceId,
      },
      reason: "Accepted proposal created this evidence candidate.",
      confidence: "medium",
    });
    const targetMap = await getTaskTargetMap(tx, [updated.id]);
    const proposalMap = await getTaskProposalMap(tx, [updated.id]);
    const revisionMap = await getTaskProposalRevisionMap(tx, [updated.id]);
    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(
        updated,
        targetMap.get(updated.id),
        proposalMap.get(updated.id),
        revisionMap.get(updated.id),
      ),
      evidenceItemId: evidence.id,
      evidenceCount: 1,
      conversionMode: "proposal_commit" as const,
    };
  });
}

async function rejectEnrichmentProposal(
  db: DbHandle,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    proposalId: string;
    now: Date;
  },
) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .update(enrichmentProposals)
      .set({
        status: "rejected",
        updatedAt: args.now,
        reviewedAt: args.now,
      })
      .where(
        and(
          eq(enrichmentProposals.workspaceId, args.task.workspaceId),
          eq(enrichmentProposals.taskId, args.task.id),
          eq(enrichmentProposals.id, args.proposalId),
          eq(enrichmentProposals.status, "pending_review"),
        ),
      )
      .returning();
    if (!proposal) return { status: "invalid" as const, reason: "proposal_not_found" as const };
    if (proposal.answerId) {
      await tx
        .update(enrichmentAnswers)
        .set({
          answerStatus: "rejected",
          updatedAt: args.now,
        })
        .where(eq(enrichmentAnswers.id, proposal.answerId));
    }
    const [updated] = await tx
      .select()
      .from(enrichmentTasks)
      .where(
        and(
          eq(enrichmentTasks.workspaceId, args.task.workspaceId),
          eq(enrichmentTasks.id, args.task.id),
        ),
      )
      .limit(1);
    const targetMap = updated ? await getTaskTargetMap(tx, [updated.id]) : new Map();
    const proposalMap = updated ? await getTaskProposalMap(tx, [updated.id]) : new Map();
    const revisionMap = updated ? await getTaskProposalRevisionMap(tx, [updated.id]) : new Map();
    return updated
      ? ({
          status: "saved" as const,
          task: toEnrichmentTaskPayload(
            updated,
            targetMap.get(updated.id),
            proposalMap.get(updated.id),
            revisionMap.get(updated.id),
          ),
        })
      : ({ status: "not_found" as const });
  });
}

async function acceptNonEvidenceEnrichmentProposal(
  tx: DbExecutor,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    proposal: typeof enrichmentProposals.$inferSelect;
    now: Date;
  },
) {
  const applyResult = await applyTypedEnrichmentProposalPatch(tx, {
    now: args.now,
    proposal: args.proposal,
    task: args.task,
  });
  if (applyResult.status !== "saved") return applyResult;
  const [proposal] = await tx
    .update(enrichmentProposals)
    .set({
      status: "accepted",
      evidenceDeltaJson: {
        ...applyResult.delta,
        stale_claims_marked: applyResult.staleClaimsMarked,
        resume_safe_note: applyResult.resumeSafeNote,
      },
      updatedAt: args.now,
      reviewedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentProposals.workspaceId, args.task.workspaceId),
        eq(enrichmentProposals.taskId, args.task.id),
        eq(enrichmentProposals.id, args.proposal.id),
        eq(enrichmentProposals.status, "pending_review"),
      ),
    )
    .returning();
  if (!proposal) {
    return { status: "invalid" as const, reason: "proposal_not_found" as const };
  }
  if (proposal.answerId) {
    await tx
      .update(enrichmentAnswers)
      .set({
        answerStatus: "applied",
        updatedAt: args.now,
      })
      .where(eq(enrichmentAnswers.id, proposal.answerId));
  }
  const [updated] = await tx
    .update(enrichmentTasks)
    .set({
      status: "converted",
      updatedAt: args.now,
      convertedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.task.workspaceId),
        eq(enrichmentTasks.id, args.task.id),
      ),
    )
    .returning();
  if (!updated) throw new Error("Failed to update accepted enrichment task.");
  const targetMap = await getTaskTargetMap(tx, [updated.id]);
  const proposalMap = await getTaskProposalMap(tx, [updated.id]);
  const revisionMap = await getTaskProposalRevisionMap(tx, [updated.id]);
  return {
    status: "saved" as const,
    task: toEnrichmentTaskPayload(
      updated,
      targetMap.get(updated.id),
      proposalMap.get(updated.id),
      revisionMap.get(updated.id),
    ),
    conversionMode: "proposal_commit" as const,
    evidenceCount: 0,
    evidenceItemId: applyResult.evidenceItemId,
  };
}

type TypedProposalApplyResult =
  | {
      status: "saved";
      delta: Record<string, unknown>;
      evidenceItemId: string | null;
      resumeSafeNote: string;
      staleClaimsMarked: number;
    }
  | {
      status: "invalid";
      reason: "invalid_proposal_payload" | "unsupported_proposal_type" | "target_not_found";
    };

async function applyTypedEnrichmentProposalPatch(
  tx: DbExecutor,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    proposal: typeof enrichmentProposals.$inferSelect;
    now: Date;
  },
): Promise<TypedProposalApplyResult> {
  if (args.proposal.proposalType === "clarify_assignment") {
    const patch = parseClarifyAssignmentProposalPatch(args.proposal.proposedPatchJson);
    if (!patch) return { status: "invalid", reason: "invalid_proposal_payload" };
    return {
      status: "saved",
      delta: {
        proposal_type: "clarify_assignment",
        text: patch.text,
        target_summary: patch.target_summary,
        applied_to_target: false,
      },
      evidenceItemId: null,
      resumeSafeNote: "Saved as context. Assign a target before turning it into evidence.",
      staleClaimsMarked: 0,
    };
  }

  if (args.proposal.proposalType === "update_initiative") {
    const patch = parseStructuredStoryProposalPatch(args.proposal.proposedPatchJson);
    if (!patch) return { status: "invalid", reason: "invalid_proposal_payload" };
    const applyResult = await applyStructuredStoryPatch(tx, {
      workspaceId: args.task.workspaceId,
      patch,
      now: args.now,
    });
    if (applyResult.status !== "saved") return applyResult;
    const staleClaimsMarked = await markGeneratedClaimsStaleForEvidenceIdsInTx(tx, {
      workspaceId: args.task.workspaceId,
      evidenceIds: applyResult.impactedEvidenceIds,
      staleReason: "Linked story context was updated.",
    });
    return {
      status: "saved",
      delta: {
        proposal_type: "update_initiative",
        target_kind: patch.target_kind,
        target_id: patch.target_id,
        changed_fields: applyResult.changedFields,
        impacted_evidence_ids: applyResult.impactedEvidenceIds,
      },
      evidenceItemId: null,
      resumeSafeNote:
        "Accepted as a story update. Resume evidence still depends on approved supporting claims.",
      staleClaimsMarked,
    };
  }

  if (args.proposal.proposalType === "update_work_experience") {
    const patch = parseStructuredRoleProposalPatch(args.proposal.proposedPatchJson);
    if (!patch) return { status: "invalid", reason: "invalid_proposal_payload" };
    const applyResult = await applyStructuredRolePatch(tx, {
      workspaceId: args.task.workspaceId,
      patch,
      now: args.now,
    });
    if (applyResult.status !== "saved") return applyResult;
    const staleClaimsMarked = await markGeneratedClaimsStaleForEvidenceIdsInTx(tx, {
      workspaceId: args.task.workspaceId,
      evidenceIds: applyResult.impactedEvidenceIds,
      staleReason: "Linked role context was updated.",
    });
    return {
      status: "saved",
      delta: {
        proposal_type: "update_work_experience",
        target_kind: "work_experience",
        target_id: patch.target_id,
        changed_fields: applyResult.changedFields,
        impacted_evidence_ids: applyResult.impactedEvidenceIds,
      },
      evidenceItemId: null,
      resumeSafeNote:
        "Accepted as a role update. Resume evidence still depends on approved supporting claims.",
      staleClaimsMarked,
    };
  }

  if (args.proposal.proposalType === "update_evidence") {
    const patch = parseEvidenceUpdateProposalPatch(args.proposal.proposedPatchJson);
    if (!patch) return { status: "invalid", reason: "invalid_proposal_payload" };
    const applyResult = await applyEvidenceUpdatePatch(tx, {
      workspaceId: args.task.workspaceId,
      patch,
      now: args.now,
    });
    if (applyResult.status !== "saved") return applyResult;
    const staleClaimsMarked = await markGeneratedClaimsStaleForEvidenceIdsInTx(tx, {
      workspaceId: args.task.workspaceId,
      evidenceIds: [patch.evidence_id],
      staleReason: "Evidence text or summary was updated.",
    });
    return {
      status: "saved",
      delta: {
        proposal_type: "update_evidence",
        evidence_id: patch.evidence_id,
        changed_fields: applyResult.changedFields,
      },
      evidenceItemId: patch.evidence_id,
      resumeSafeNote:
        "Updated the evidence draft. Resume-safe approval remains a separate review step.",
      staleClaimsMarked,
    };
  }

  return { status: "invalid", reason: "unsupported_proposal_type" };
}

function canAcceptGeneralEnrichmentProposal(type: EnrichmentProposalType) {
  return (
    type === "clarify_assignment" ||
    type === "update_evidence" ||
    type === "update_initiative" ||
    type === "update_work_experience"
  );
}

async function applyStructuredStoryPatch(
  tx: DbExecutor,
  args: {
    workspaceId: string;
    patch: StructuredStoryProposalPatch;
    now: Date;
  },
): Promise<
  | { status: "saved"; changedFields: string[]; impactedEvidenceIds: string[] }
  | { status: "invalid"; reason: "target_not_found" }
> {
  if (args.patch.target_kind === "initiative") {
    const [current] = await tx
      .select()
      .from(initiatives)
      .where(
        and(
          eq(initiatives.workspaceId, args.workspaceId),
          eq(initiatives.id, args.patch.target_id),
        ),
      )
      .limit(1);
    if (!current || current.status === "rejected") {
      return { status: "invalid", reason: "target_not_found" };
    }
    const changedFields = structuredStoryChangedFields(args.patch);
    await tx
      .update(initiatives)
      .set({
        internalTitle: args.patch.title_patch ?? current.internalTitle,
        context: appendAcceptedContext(current.context, args.patch.context_patch),
        problem: appendAcceptedContext(current.problem, args.patch.problem_patch),
        role: appendAcceptedContext(current.role, args.patch.role_patch),
        actions: mergeStringArray(current.actions, args.patch.actions_add),
        results: mergeStringArray(current.results, args.patch.results_add),
        metrics: mergeJsonArray(current.metrics, args.patch.metrics_add),
        technologies: mergeStringArray(current.technologies, args.patch.technologies_add),
        stakeholders: mergeStringArray(current.stakeholders, args.patch.stakeholders_add),
        externalSafeSummary:
          args.patch.external_safe_summary_patch === undefined
            ? current.externalSafeSummary
            : args.patch.external_safe_summary_patch,
        updatedAt: args.now,
      })
      .where(
        and(
          eq(initiatives.workspaceId, args.workspaceId),
          eq(initiatives.id, args.patch.target_id),
        ),
      );
    const impactedEvidenceIds = await getEvidenceIdsForStoryTarget(tx, {
      workspaceId: args.workspaceId,
      targetKind: "initiative",
      targetId: args.patch.target_id,
    });
    return { status: "saved", changedFields, impactedEvidenceIds };
  }

  const [current] = await tx
    .select()
    .from(portfolioProjects)
    .where(
      and(
        eq(portfolioProjects.workspaceId, args.workspaceId),
        eq(portfolioProjects.id, args.patch.target_id),
      ),
    )
    .limit(1);
  if (!current || current.status === "rejected") {
    return { status: "invalid", reason: "target_not_found" };
  }
  const changedFields = structuredStoryChangedFields(args.patch);
  await tx
    .update(portfolioProjects)
    .set({
      title: args.patch.title_patch ?? current.title,
      context: appendAcceptedContext(current.context, args.patch.context_patch),
      problem: appendAcceptedContext(current.problem, args.patch.problem_patch),
      role: appendAcceptedContext(current.role, args.patch.role_patch),
      actions: mergeStringArray(current.actions, args.patch.actions_add),
      results: mergeStringArray(current.results, args.patch.results_add),
      metrics: mergeJsonArray(current.metrics, args.patch.metrics_add),
      technologies: mergeStringArray(current.technologies, args.patch.technologies_add),
      stakeholders: mergeStringArray(current.stakeholders, args.patch.stakeholders_add),
      externalSafeSummary:
        args.patch.external_safe_summary_patch === undefined
          ? current.externalSafeSummary
          : args.patch.external_safe_summary_patch,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(portfolioProjects.workspaceId, args.workspaceId),
        eq(portfolioProjects.id, args.patch.target_id),
      ),
    );
  const impactedEvidenceIds = await getEvidenceIdsForStoryTarget(tx, {
    workspaceId: args.workspaceId,
    targetKind: "portfolio_project",
    targetId: args.patch.target_id,
  });
  return { status: "saved", changedFields, impactedEvidenceIds };
}

async function applyStructuredRolePatch(
  tx: DbExecutor,
  args: {
    workspaceId: string;
    patch: StructuredRoleProposalPatch;
    now: Date;
  },
): Promise<
  | { status: "saved"; changedFields: string[]; impactedEvidenceIds: string[] }
  | { status: "invalid"; reason: "target_not_found" }
> {
  const [current] = await tx
    .select()
    .from(workExperiences)
    .where(
      and(
        eq(workExperiences.workspaceId, args.workspaceId),
        eq(workExperiences.id, args.patch.target_id),
      ),
    )
    .limit(1);
  if (!current || current.status === "rejected") {
    return { status: "invalid", reason: "target_not_found" };
  }
  const changedFields = structuredRoleChangedFields(args.patch);
  await tx
    .update(workExperiences)
    .set({
      summary: appendAcceptedContext(current.summary, args.patch.summary_patch),
      team: args.patch.team_patch === undefined ? current.team : args.patch.team_patch,
      location:
        args.patch.location_patch === undefined ? current.location : args.patch.location_patch,
      startDate: args.patch.date_patch?.start_date ?? current.startDate,
      endDate: args.patch.date_patch?.end_date ?? current.endDate,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(workExperiences.workspaceId, args.workspaceId),
        eq(workExperiences.id, args.patch.target_id),
      ),
    );
  const impactedEvidenceIds = await getEvidenceIdsForWorkExperience(tx, {
    workspaceId: args.workspaceId,
    workExperienceId: args.patch.target_id,
  });
  return { status: "saved", changedFields, impactedEvidenceIds };
}

async function applyEvidenceUpdatePatch(
  tx: DbExecutor,
  args: {
    workspaceId: string;
    patch: EvidenceUpdateProposalPatch;
    now: Date;
  },
): Promise<
  | { status: "saved"; changedFields: string[] }
  | { status: "invalid"; reason: "target_not_found" }
> {
  const [current] = await tx
    .select()
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, args.workspaceId),
        eq(evidenceItems.id, args.patch.evidence_id),
      ),
    )
    .limit(1);
  if (!current || current.status === "rejected") {
    return { status: "invalid", reason: "target_not_found" };
  }
  const changedFields = evidenceUpdateChangedFields(args.patch);
  await tx
    .update(evidenceItems)
    .set({
      text: args.patch.text_patch ?? current.text,
      sourceQuote: args.patch.source_quote_patch ?? current.sourceQuote,
      publicSafeSummary:
        args.patch.public_safe_summary_patch === undefined
          ? current.publicSafeSummary
          : args.patch.public_safe_summary_patch,
      metrics: mergeJsonArray(current.metrics, args.patch.metrics_add),
      sensitivityLevel: args.patch.sensitivity_level_patch ?? current.sensitivityLevel,
      status: "pending",
      allowedUsage: current.allowedUsage.filter(
        (usage) => usage !== "resume",
      ),
      needsUserConfirmation: 1,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(evidenceItems.workspaceId, args.workspaceId),
        eq(evidenceItems.id, args.patch.evidence_id),
      ),
    );
  return { status: "saved", changedFields };
}

async function getEvidenceIdsForStoryTarget(
  tx: Pick<DbHandle, "select">,
  args: {
    workspaceId: string;
    targetKind: "initiative" | "portfolio_project";
    targetId: string;
  },
) {
  const condition =
    args.targetKind === "initiative"
      ? eq(evidenceItems.relatedInitiativeId, args.targetId)
      : eq(evidenceItems.relatedPortfolioProjectId, args.targetId);
  const rows = await tx
    .select({ id: evidenceItems.id })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, args.workspaceId), condition));
  return rows.map((row) => row.id);
}

async function getEvidenceIdsForWorkExperience(
  tx: Pick<DbHandle, "select">,
  args: {
    workspaceId: string;
    workExperienceId: string;
  },
) {
  const directRows = await tx
    .select({ id: evidenceItems.id })
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, args.workspaceId),
        eq(evidenceItems.relatedWorkExperienceId, args.workExperienceId),
      ),
    );
  const storyRows = await tx
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(
      and(
        eq(initiatives.workspaceId, args.workspaceId),
        eq(initiatives.workExperienceId, args.workExperienceId),
      ),
    );
  if (storyRows.length === 0) return directRows.map((row) => row.id);
  const storyEvidenceRows = await tx
    .select({ id: evidenceItems.id })
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, args.workspaceId),
        inArray(evidenceItems.relatedInitiativeId, storyRows.map((row) => row.id)),
      ),
    );
  return Array.from(new Set([...directRows, ...storyEvidenceRows].map((row) => row.id)));
}

async function markGeneratedClaimsStaleForEvidenceIdsInTx(
  tx: Pick<DbHandle, "select" | "update">,
  args: {
    workspaceId: string;
    evidenceIds: string[];
    staleReason: string;
  },
) {
  const evidenceIds = Array.from(new Set(args.evidenceIds.filter(Boolean)));
  if (evidenceIds.length === 0) return 0;
  const rows = await tx
    .select({
      id: generatedClaims.id,
      evidenceIds: generatedClaims.evidenceIds,
    })
    .from(generatedClaims)
    .where(eq(generatedClaims.workspaceId, args.workspaceId));
  const impacted = rows.filter((claim) =>
    claim.evidenceIds.some((id) => evidenceIds.includes(id)),
  );
  if (impacted.length === 0) return 0;
  await tx
    .update(generatedClaims)
    .set({
      claimStatus: "stale",
      staleReason: args.staleReason,
      lastValidatedAt: null,
    })
    .where(
      and(
        eq(generatedClaims.workspaceId, args.workspaceId),
        inArray(generatedClaims.id, impacted.map((claim) => claim.id)),
      ),
    );
  return impacted.length;
}

function structuredStoryChangedFields(patch: StructuredStoryProposalPatch) {
  return [
    patch.title_patch ? "title" : null,
    patch.context_patch ? "context" : null,
    patch.problem_patch ? "problem" : null,
    patch.role_patch ? "role" : null,
    patch.actions_add?.length ? "actions" : null,
    patch.results_add?.length ? "results" : null,
    patch.metrics_add?.length ? "metrics" : null,
    patch.technologies_add?.length ? "technologies" : null,
    patch.stakeholders_add?.length ? "stakeholders" : null,
    patch.external_safe_summary_patch !== undefined ? "external_safe_summary" : null,
  ].filter((value): value is string => Boolean(value));
}

function structuredRoleChangedFields(patch: StructuredRoleProposalPatch) {
  return [
    patch.summary_patch ? "summary" : null,
    patch.team_patch !== undefined ? "team" : null,
    patch.location_patch !== undefined ? "location" : null,
    patch.date_patch?.start_date ? "start_date" : null,
    patch.date_patch?.end_date ? "end_date" : null,
  ].filter((value): value is string => Boolean(value));
}

function evidenceUpdateChangedFields(patch: EvidenceUpdateProposalPatch) {
  return [
    patch.text_patch ? "text" : null,
    patch.source_quote_patch ? "source_quote" : null,
    patch.public_safe_summary_patch !== undefined ? "public_safe_summary" : null,
    patch.metrics_add?.length ? "metrics" : null,
    patch.sensitivity_level_patch ? "sensitivity_level" : null,
  ].filter((value): value is string => Boolean(value));
}

function appendAcceptedContext(existing: string | null, next?: string | null) {
  const cleanNext = next?.trim();
  if (!cleanNext) return existing;
  const cleanExisting = existing?.trim();
  if (!cleanExisting) return cleanNext;
  if (normalizeContextText(cleanExisting).includes(normalizeContextText(cleanNext))) {
    return cleanExisting;
  }
  return `${cleanExisting}\n\n${cleanNext}`;
}

function normalizeContextText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function mergeStringArray(existing: string[] | null | undefined, additions?: string[]) {
  const values = [...(existing ?? [])];
  for (const addition of additions ?? []) {
    const clean = addition.trim();
    if (!clean) continue;
    if (!values.some((value) => normalizeContextText(value) === normalizeContextText(clean))) {
      values.push(clean);
    }
  }
  return values;
}

function mergeJsonArray<T extends Record<string, unknown>>(
  existing: T[] | null | undefined,
  additions?: T[],
) {
  const values = [...(existing ?? [])];
  const seen = new Set(values.map((value) => stableJsonKey(value)));
  for (const addition of additions ?? []) {
    const key = stableJsonKey(addition);
    if (!seen.has(key)) {
      values.push(addition);
      seen.add(key);
    }
  }
  return values;
}

function stableJsonKey(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = value[key];
        return accumulator;
      }, {}),
  );
}

async function reviseEnrichmentProposal(
  db: DbHandle,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    proposalId: string;
    revisedText?: string;
    revisionInstruction?: string;
    now: Date;
  },
) {
  const revisedText = args.revisedText?.trim();
  const revisionInstruction = args.revisionInstruction?.trim();
  if (!revisedText && !revisionInstruction) {
    return { status: "invalid" as const, reason: "missing_revision" as const };
  }

  const [existingProposal] = await db
    .select()
    .from(enrichmentProposals)
    .where(
      and(
        eq(enrichmentProposals.workspaceId, args.task.workspaceId),
        eq(enrichmentProposals.taskId, args.task.id),
        eq(enrichmentProposals.id, args.proposalId),
        eq(enrichmentProposals.status, "pending_review"),
      ),
    )
    .limit(1);
  if (!existingProposal) {
    return { status: "invalid" as const, reason: "proposal_not_found" as const };
  }
  if (
    existingProposal.proposalType !== "create_evidence" &&
    !canAcceptGeneralEnrichmentProposal(existingProposal.proposalType)
  ) {
    return { status: "invalid" as const, reason: "unsupported_proposal_type" as const };
  }
  const revisedPatch = await buildRevisedEnrichmentProposalPatch({
    currentPatchJson: existingProposal.proposedPatchJson,
    proposalType: existingProposal.proposalType,
    revisionInstruction,
    revisedText,
    task: args.task,
  });
  if (revisedPatch.status === "invalid") {
    return { status: "invalid" as const, reason: revisedPatch.reason };
  }

  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select()
      .from(enrichmentProposals)
      .where(
        and(
          eq(enrichmentProposals.workspaceId, args.task.workspaceId),
          eq(enrichmentProposals.taskId, args.task.id),
          eq(enrichmentProposals.id, args.proposalId),
          eq(enrichmentProposals.status, "pending_review"),
        ),
      )
      .limit(1);
    if (!proposal) return { status: "invalid" as const, reason: "proposal_not_found" as const };
    await tx
      .update(enrichmentProposals)
      .set({
        status: "rejected",
        updatedAt: args.now,
        reviewedAt: args.now,
      })
      .where(eq(enrichmentProposals.id, proposal.id));

    const [nextProposal] = await tx
      .insert(enrichmentProposals)
      .values({
        workspaceId: args.task.workspaceId,
        taskId: args.task.id,
        answerId: proposal.answerId,
        proposalType: proposal.proposalType,
        targetKind: proposal.targetKind,
        targetId: proposal.targetId,
        proposedPatchJson: revisedPatch.patch,
        evidenceDeltaJson: {
          text: getProposalPatchPreviewText(revisedPatch.patch),
          target_summary: summarizeProposalTarget(args.task),
          revision_instruction: revisionInstruction || null,
          resume_safe_note: resumeSafeNoteForProposalType(proposal.proposalType),
        },
        schemaVersion: proposal.schemaVersion,
        status: "pending_review",
        createdAt: args.now,
        updatedAt: args.now,
      })
      .returning();
    if (!nextProposal) throw new Error("Failed to create revised enrichment proposal.");

    try {
      await tx.insert(enrichmentProposalRevisions).values({
        workspaceId: args.task.workspaceId,
        taskId: args.task.id,
        proposalId: proposal.id,
        nextProposalId: nextProposal.id,
        actor: revisedText ? "user" : "ai",
        mode: revisedText ? "manual_edit" : "ai_revision",
        instruction: revisionInstruction || null,
        previousText: revisedPatch.previousText,
        revisedText: getProposalPatchPreviewText(revisedPatch.patch),
        createdAt: args.now,
      });
    } catch (error) {
      if (!isMissingProposalRevisionsTableError(error)) throw error;
      console.warn(
        "[enrichment] proposal revision history table is unavailable; revised proposal saved without history",
      );
    }

    const [updated] = await tx
      .select()
      .from(enrichmentTasks)
      .where(
        and(
          eq(enrichmentTasks.workspaceId, args.task.workspaceId),
          eq(enrichmentTasks.id, args.task.id),
        ),
      )
      .limit(1);
    const targetMap = updated ? await getTaskTargetMap(tx, [updated.id]) : new Map();
    const proposalMap = updated ? await getTaskProposalMap(tx, [updated.id]) : new Map();
    const revisionMap = updated ? await getTaskProposalRevisionMap(tx, [updated.id]) : new Map();
    return updated
      ? ({
          status: "saved" as const,
          task: toEnrichmentTaskPayload(
            updated,
            targetMap.get(updated.id),
            proposalMap.get(updated.id),
            revisionMap.get(updated.id),
          ),
        })
      : ({ status: "not_found" as const });
  });
}

async function buildRevisedEnrichmentProposalPatch(args: {
  currentPatchJson: Record<string, unknown>;
  proposalType: EnrichmentProposalType;
  revisedText?: string;
  revisionInstruction?: string;
  task: typeof enrichmentTasks.$inferSelect;
}): Promise<
  | { status: "saved"; patch: EnrichmentProposalPatch; previousText: string }
  | {
      status: "invalid";
      reason: "invalid_proposal_payload" | "invalid_revision_payload";
    }
> {
  const currentPatch = parseProposalPatchForType(args.proposalType, args.currentPatchJson);
  if (!currentPatch) {
    return { status: "invalid" as const, reason: "invalid_proposal_payload" as const };
  }

  let nextText = args.revisedText;
  const previousText = getProposalPatchPreviewText(currentPatch);
  let nextSourceQuote = args.revisedText || getProposalPatchSourceQuote(currentPatch) || previousText;
  if (!nextText && args.revisionInstruction) {
    const aiRevision = await reviseEnrichmentProposalWithAi({
      currentDraft: previousText,
      originalAnswer: args.task.userAnswer,
      revisionInstruction: args.revisionInstruction,
      targetLabel: summarizeProposalTarget(args.task),
      taskPrompt: args.task.prompt,
    });
    nextText = aiRevision.data.text.trim();
    nextSourceQuote =
      aiRevision.data.source_quote?.trim() ||
      getProposalPatchSourceQuote(currentPatch) ||
      previousText;
  }

  if (!nextText || nextText.length < 12) {
    return { status: "invalid" as const, reason: "invalid_revision_payload" as const };
  }
  return {
    status: "saved" as const,
    patch: applyRevisedTextToProposalPatch(currentPatch, nextText, nextSourceQuote),
    previousText,
  };
}

async function rejectPendingProposals(
  db: Pick<DbHandle, "update">,
  args: {
    workspaceId: string;
    taskId: string;
    now: Date;
  },
) {
  await db
    .update(enrichmentProposals)
    .set({
      status: "rejected",
      updatedAt: args.now,
      reviewedAt: args.now,
    })
    .where(
      and(
        eq(enrichmentProposals.workspaceId, args.workspaceId),
        eq(enrichmentProposals.taskId, args.taskId),
        eq(enrichmentProposals.status, "pending_review"),
      ),
    );
}

async function buildEnrichmentProposalDraft(
  db: Pick<DbHandle, "select">,
  task: typeof enrichmentTasks.$inferSelect,
  answer: string,
): Promise<EnrichmentProposalDraft> {
  const proposalType = proposalTypeForTask(task);
  if (proposalType === "create_evidence") {
    const patch = buildCreateEvidenceProposalPatch(task, answer);
    return {
      nextStepNote:
        "Accepting creates draft evidence. Resume-safe approval still requires review.",
      patch,
      proposalType: "create_evidence",
      targetId: task.evidenceItemId,
      targetKind: "evidence",
    };
  }
  if (proposalType === "update_evidence" && task.evidenceItemId) {
    const currentEvidenceText = await getEvidenceTextForProposal(db, {
      workspaceId: task.workspaceId,
      evidenceItemId: task.evidenceItemId,
    });
    const patch = buildEvidenceUpdateProposalPatch(task, answer, currentEvidenceText);
    return {
      nextStepNote:
        "Accepting updates this evidence draft. Resume-safe approval still requires review.",
      patch,
      proposalType,
      targetId: task.evidenceItemId,
      targetKind: "evidence",
    };
  }
  const target = proposalTargetForTask(task);
  const patch = buildNonEvidenceProposalPatch(task, answer, proposalType, target);
  return {
    nextStepNote:
      proposalType === "update_initiative"
        ? "Accepting applies this as story context. It does not become resume evidence by itself."
        : proposalType === "update_work_experience"
          ? "Accepting applies this as role context. It does not become resume evidence by itself."
          : "This answer needs a clearer target before JobDesk can save it as evidence.",
    patch,
    proposalType,
    targetId: target.targetId,
    targetKind: target.targetKind,
  };
}

async function buildAndEnhanceEnrichmentProposalDraft(
  db: Pick<DbHandle, "select">,
  args: {
    answer: string;
    task: typeof enrichmentTasks.$inferSelect;
  },
): Promise<EnrichmentProposalDraft> {
  const draft = await buildEnrichmentProposalDraft(db, args.task, args.answer);
  return enhanceInitialEnrichmentProposalDraft({
    answer: args.answer,
    draft,
    task: args.task,
  });
}

async function enhanceInitialEnrichmentProposalDraft(args: {
  answer: string;
  draft: EnrichmentProposalDraft;
  task: typeof enrichmentTasks.$inferSelect;
}): Promise<EnrichmentProposalDraft> {
  if (!shouldGenerateInitialProposalWithAi(args.draft.proposalType)) return args.draft;
  const config = resolveJobDeskAiConfig();
  if (!config.providerEnabled || !config.apiKey) return args.draft;

  const previousText = getProposalPatchPreviewText(args.draft.patch);
  try {
    const aiRevision = await reviseEnrichmentProposalWithAi({
      currentDraft: previousText,
      originalAnswer: args.answer,
      revisionInstruction: buildInitialProposalGenerationInstruction(args.draft.proposalType),
      targetLabel: summarizeProposalTarget(args.task),
      taskPrompt: args.task.prompt,
    });
    const revisedText = aiRevision.data.text.trim();
    if (revisedText.length < 12) return args.draft;
    const revisedPatch = applyRevisedTextToProposalPatch(
      args.draft.patch,
      revisedText,
      aiRevision.data.source_quote?.trim() ||
        getProposalPatchSourceQuote(args.draft.patch) ||
        args.answer,
    );
    const parsedPatch = parseProposalPatchForType(args.draft.proposalType, revisedPatch);
    if (!parsedPatch) return args.draft;
    return {
      ...args.draft,
      patch: parsedPatch,
    };
  } catch (error) {
    if (error instanceof JobDeskAiError) {
      console.warn("[enrichment] initial proposal AI generation fell back", {
        errorKind: error.kind,
        retryCount: error.retryCount,
        taskId: args.task.id,
      });
      return args.draft;
    }
    throw error;
  }
}

function shouldGenerateInitialProposalWithAi(type: EnrichmentProposalType) {
  return (
    type === "create_evidence" ||
    type === "update_evidence" ||
    type === "update_initiative" ||
    type === "update_work_experience"
  );
}

function shouldSaveProfileContextAnswer(task: typeof enrichmentTasks.$inferSelect) {
  return task.targetScope === "profile_context" || task.expectedOutcome === "save_profile_answer";
}

function canCreateStoryTargetFromTask(task: typeof enrichmentTasks.$inferSelect) {
  if (
    task.taskType === "source_section_review" ||
    task.targetScope === "source_material" ||
    task.targetScope === "profile_context" ||
    task.targetScope === "profile_fact" ||
    task.expectedOutcome === "review_imported_material" ||
    task.expectedOutcome === "save_profile_answer" ||
    task.expectedOutcome === "update_profile_fact"
  ) {
    return false;
  }
  if (
    task.expectedAction &&
    task.expectedAction !== "answer_enrichment_question"
  ) {
    return false;
  }
  return (
    task.targetScope === "story_context" ||
    task.targetScope === "evidence_detail" ||
    task.targetScope === "assign_later" ||
    task.expectedOutcome === "update_story" ||
    task.expectedOutcome === "update_evidence" ||
    task.expectedOutcome === "route_answer"
  );
}

function normalizeStoryTargetTitle(title: string) {
  const normalized = title.trim().replace(/\s+/g, " ");
  return normalized.length > 240 ? normalized.slice(0, 240).trim() : normalized;
}

function normalizeOptionalStoryField(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 2000) : null;
}

function buildStoryTargetCreationContext(args: {
  prompt: string;
  sourceQuote?: string | null;
  userContext?: string | null;
}) {
  const context = normalizeOptionalStoryField(args.userContext);
  const sourceQuote = normalizeOptionalStoryField(args.sourceQuote);
  const fallback = normalizeOptionalStoryField(`Created from enrichment question: ${args.prompt}`);
  if (!sourceQuote) return context ?? fallback;
  if (!context) return sourceQuote;
  if (context.includes(sourceQuote)) return context;
  return normalizeOptionalStoryField(`${context}\nSource context: ${sourceQuote}`) ?? context;
}

function normalizeStoryFieldList(values: string[] | null | undefined) {
  return (values ?? [])
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 12);
}

function canSaveProfileContextRoute(task: typeof enrichmentTasks.$inferSelect) {
  if (shouldSaveProfileContextAnswer(task)) return true;
  if (task.targetScope !== "assign_later" && task.expectedOutcome !== "route_answer") {
    return false;
  }
  return !Boolean(
    task.evidenceItemId ||
      task.initiativeId ||
      task.portfolioProjectId ||
      task.workExperienceId,
  );
}

function inferProfileContextType(
  prompt: string,
  answer: string,
): (typeof profileContextTypeEnum.enumValues)[number] {
  const normalized = `${prompt} ${answer}`.toLowerCase();
  if (/\b(avoid|deprioritize|less|not emphasize|hide|downplay)\b/.test(normalized) && /\b(skills?|techniques?|tech|technology|tool|framework)\b/.test(normalized)) {
    return "skills_to_avoid";
  }
  if (/\b(skills?|techniques?|technology|technical|tool|framework|language)\b/.test(normalized)) {
    return "skills_to_emphasize";
  }
  if (/\b(location|relocat|remote|hybrid|onsite|on-site|work style|timezone)\b/.test(normalized)) {
    return "work_style_preference";
  }
  if (/\b(target role|future role|role direction|career direction|next role|software engineering role)\b/.test(normalized)) {
    return "target_role_preference";
  }
  if (/\b(positioning|emphasize|highlight|focus|prioritize|strongest|most recent)\b/.test(normalized)) {
    return "positioning_preference";
  }
  return "general_preference";
}

function normalizeProfileContextTags(prompt: string, answer: string) {
  const text = `${prompt} ${answer}`.toLowerCase();
  const tags = new Set<string>();
  const tagPatterns: Array<[string, RegExp]> = [
    ["skills", /\b(skills?|techniques?|technical|technology|tool|framework|language)\b/],
    ["future_roles", /\b(future role|target role|next role|career direction)\b/],
    ["positioning", /\b(positioning|emphasize|highlight|prioritize|focus)\b/],
    ["location", /\b(location|remote|hybrid|onsite|relocat|timezone)\b/],
    ["avoid", /\b(avoid|deprioritize|downplay|not emphasize)\b/],
    ["work_style", /\b(work style|remote|hybrid|onsite|on-site)\b/],
  ];
  for (const [tag, pattern] of tagPatterns) {
    if (pattern.test(text)) tags.add(tag);
  }
  return Array.from(tags);
}

function shouldCreateProposalForTask(task: typeof enrichmentTasks.$inferSelect) {
  return (
    task.expectedOutcome === "create_evidence" ||
    task.expectedOutcome === "update_evidence" ||
    task.expectedOutcome === "update_story" ||
    task.expectedOutcome === "update_role" ||
    task.expectedOutcome === "route_answer" ||
    Boolean(task.evidenceItemId || task.initiativeId || task.portfolioProjectId || task.workExperienceId)
  );
}

function validateConfirmedTargetForProposal(task: typeof enrichmentTasks.$inferSelect) {
  if (task.expectedOutcome === "create_evidence") return { status: "ready" as const };
  if (task.expectedOutcome === "update_evidence") {
    return task.evidenceItemId
      ? { status: "ready" as const }
      : { status: "target_required" as const };
  }
  if (task.expectedOutcome === "update_story") {
    return task.initiativeId || task.portfolioProjectId
      ? { status: "ready" as const }
      : { status: "target_required" as const };
  }
  if (task.expectedOutcome === "update_role") {
    return task.workExperienceId
      ? { status: "ready" as const }
      : { status: "target_required" as const };
  }
  if (task.evidenceItemId || task.initiativeId || task.portfolioProjectId || task.workExperienceId) {
    return { status: "ready" as const };
  }
  if (task.expectedOutcome === "route_answer") {
    return { status: "target_required" as const };
  }
  return { status: "target_required" as const };
}

async function validateTargetForProposalGeneration(
  db: Pick<DbHandle, "select">,
  task: typeof enrichmentTasks.$inferSelect,
) {
  const confirmed = validateConfirmedTargetForProposal(task);
  if (confirmed.status === "ready") return confirmed;
  const activeSuggestedTargets = await db
    .select({ id: enrichmentTaskTargets.id })
    .from(enrichmentTaskTargets)
    .where(
      and(
        eq(enrichmentTaskTargets.workspaceId, task.workspaceId),
        eq(enrichmentTaskTargets.taskId, task.id),
        eq(enrichmentTaskTargets.targetRole, "suggested"),
        sql`${enrichmentTaskTargets.rejectedAt} is null`,
      ),
    )
    .limit(1);
  return activeSuggestedTargets.length > 0
    ? { status: "target_confirmation_required" as const }
    : confirmed;
}

function canAcknowledgeEnrichmentTask(task: typeof enrichmentTasks.$inferSelect) {
  return (
    task.expectedAction === "acknowledge" ||
    task.noteKind === "observation" ||
    task.expectedOutcome === "review_imported_material"
  );
}

function canResolveImportedNote(task: typeof enrichmentTasks.$inferSelect) {
  return (
    task.taskType === "source_section_review" ||
    (task.sourceType === "extraction_note" &&
      task.expectedOutcome === "review_imported_material" &&
      task.targetScope === "source_material" &&
      Boolean(task.noteKind || task.expectedAction))
  );
}

export function buildInitialProposalGenerationInstruction(type: EnrichmentProposalType) {
  if (type === "create_evidence") {
    return "Generate a concise draft evidence statement from the user's answer. Use only confirmed facts. Keep the user's answer as source_quote.";
  }
  if (type === "update_evidence") {
    return "Generate a conservative suggested evidence update from the user's answer and current draft. Keep the wording factual, avoid first person, and do not broaden beyond confirmed facts.";
  }
  if (type === "update_initiative") {
    return "Generate a concise story-context update from the user's answer. Make it useful for the existing project/story, but do not turn it into resume-ready evidence.";
  }
  if (type === "update_work_experience") {
    return "Generate a concise role-context update from the user's answer. Make it useful for the existing role, but do not turn it into resume-ready evidence.";
  }
  return "Generate a concise suggested update from the user's answer using only confirmed facts.";
}

async function getEvidenceTextForProposal(
  db: Pick<DbHandle, "select">,
  args: { workspaceId: string; evidenceItemId: string },
) {
  const [current] = await db
    .select({ text: evidenceItems.text })
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, args.workspaceId),
        eq(evidenceItems.id, args.evidenceItemId),
      ),
    )
    .limit(1);
  return current?.text ?? null;
}

function proposalTypeForTask(task: typeof enrichmentTasks.$inferSelect): EnrichmentProposalType {
  if (task.expectedOutcome === "save_profile_answer") return "clarify_assignment";
  if (task.expectedOutcome === "route_answer") return "clarify_assignment";
  if (task.expectedOutcome === "create_evidence") return "create_evidence";
  if (task.expectedOutcome === "update_evidence" || task.evidenceItemId) {
    return task.evidenceItemId ? "update_evidence" : "create_evidence";
  }
  if (task.expectedOutcome === "update_story" || task.initiativeId || task.portfolioProjectId) {
    return "update_initiative";
  }
  if (task.expectedOutcome === "update_role" || task.workExperienceId) {
    return "update_work_experience";
  }
  return "clarify_assignment";
}

function proposalTargetForTask(task: typeof enrichmentTasks.$inferSelect): {
  targetId: string | null;
  targetKind: EnrichmentTaskTargetKind | null;
} {
  if (task.initiativeId) return { targetId: task.initiativeId, targetKind: "initiative" };
  if (task.portfolioProjectId) {
    return { targetId: task.portfolioProjectId, targetKind: "portfolio_project" };
  }
  if (task.workExperienceId) {
    return { targetId: task.workExperienceId, targetKind: "work_experience" };
  }
  if (task.evidenceItemId) return { targetId: task.evidenceItemId, targetKind: "evidence" };
  return { targetId: null, targetKind: null };
}

function buildCreateEvidenceProposalPatch(
  task: typeof enrichmentTasks.$inferSelect,
  answer: string,
): CreateEvidenceProposalPatch {
  const cleanAnswer = answer.trim();
  return {
    text: cleanAnswer,
    source_quote: cleanAnswer,
    evidence_type: "user_confirmed",
    metrics: [],
    sensitivity_level: "private",
    allowed_usage: [],
    public_safe_summary: null,
    status: "pending",
    ...buildCreateEvidenceProposalRelationForTask(task),
    needs_user_confirmation: true,
  };
}

function buildCreateEvidenceProposalRelationForTask(task: typeof enrichmentTasks.$inferSelect) {
  return {
    related_work_experience_id:
      task.initiativeId || task.portfolioProjectId ? null : task.workExperienceId,
    related_initiative_id: task.initiativeId,
    related_portfolio_project_id: task.portfolioProjectId,
  };
}

function buildEvidenceRelationForTask(task: typeof enrichmentTasks.$inferSelect) {
  return {
    relatedWorkExperienceId:
      task.initiativeId || task.portfolioProjectId ? null : task.workExperienceId,
    relatedInitiativeId: task.initiativeId,
    relatedPortfolioProjectId: task.portfolioProjectId,
  };
}

function buildEvidenceRelationForAcceptedProposal(
  task: typeof enrichmentTasks.$inferSelect,
  patch: CreateEvidenceProposalPatch,
) {
  const taskRelation = buildEvidenceRelationForTask(task);
  if (
    taskRelation.relatedWorkExperienceId ||
    taskRelation.relatedInitiativeId ||
    taskRelation.relatedPortfolioProjectId
  ) {
    return taskRelation;
  }
  return {
    relatedWorkExperienceId:
      patch.related_initiative_id || patch.related_portfolio_project_id
        ? null
        : patch.related_work_experience_id,
    relatedInitiativeId: patch.related_initiative_id,
    relatedPortfolioProjectId: patch.related_portfolio_project_id,
  };
}

export function buildEvidenceUpdateProposalPatch(
  task: typeof enrichmentTasks.$inferSelect,
  answer: string,
  currentEvidenceText?: string | null,
): EvidenceUpdateProposalPatch {
  const cleanAnswer = answer.trim();
  const textPatch = buildConservativeEvidenceRewrite(currentEvidenceText ?? "", cleanAnswer);
  const patch: EvidenceUpdateProposalPatch = {
    patch_type: "update_evidence",
    evidence_id: task.evidenceItemId ?? "",
    source_quote_patch: cleanAnswer,
    rationale: textPatch
      ? "Use the user's answer as supporting detail and preview a conservative evidence rewrite."
      : "Use the user's answer as supporting detail. Keep the canonical evidence wording unchanged until a safe rewrite is available.",
    confidence: "medium",
  };
  if (textPatch) patch.text_patch = textPatch;
  return patch;
}

export function buildConservativeEvidenceRewrite(
  existingText: string,
  support: string,
): string | undefined {
  const existing = existingText.trim();
  const detail = support.trim();
  if (!existing || !detail || detail.length < 24) return undefined;
  const existingLower = existing.toLowerCase();
  const detailLower = detail.toLowerCase();
  const hasRequestApiMetric =
    /(20\+?|more than 20).{0,40}\b(10|ten)\b/.test(existingLower) ||
    /\b(10|ten)\b.{0,40}(20\+?|more than 20)/.test(existingLower);
  const hasTimeMetric =
    /\b2\s*weeks?\b.{0,40}\b1\s*weeks?\b/.test(existingLower) ||
    /\b1\s*weeks?\b.{0,40}\b2\s*weeks?\b/.test(existingLower);
  const mentionsRequestFlow = /\b(api|apis|endpoint|endpoints|request|requests)\b/.test(
    detailLower,
  );
  const mentionsValidationOrSchema = /\b(schema|validation|validate|processing workflow|workflow)\b/.test(
    detailLower,
  );
  const isConversationalOnly =
    /^(i think|i guess|maybe|probably|there were|because|so)\b/.test(detailLower) &&
    detail.split(/\s+/).length < 10;

  if (
    hasRequestApiMetric &&
    hasTimeMetric &&
    mentionsRequestFlow &&
    mentionsValidationOrSchema &&
    !isConversationalOnly
  ) {
    return "Reduced raw-data crawl/fetch time from 2 weeks to 1 week by simplifying backend request flow from 20+ APIs to 10 and improving schema validation.";
  }

  return undefined;
}

function buildNonEvidenceProposalPatch(
  task: typeof enrichmentTasks.$inferSelect,
  answer: string,
  proposalType: EnrichmentProposalType,
  target: { targetId: string | null; targetKind: EnrichmentTaskTargetKind | null },
): EnrichmentProposalPatch {
  const cleanAnswer = answer.trim();
  if (
    proposalType === "update_initiative" &&
    target.targetId &&
    (target.targetKind === "initiative" || target.targetKind === "portfolio_project")
  ) {
    return {
      patch_type: "update_initiative",
      target_kind: target.targetKind,
      target_id: target.targetId,
      context_patch: cleanAnswer,
      rationale: "Use the answer as additional story context.",
      confidence: "medium",
    };
  }
  if (
    proposalType === "update_work_experience" &&
    target.targetId &&
    target.targetKind === "work_experience"
  ) {
    return {
      patch_type: "update_work_experience",
      target_kind: "work_experience",
      target_id: target.targetId,
      summary_patch: cleanAnswer,
      rationale: "Use the answer as additional role context.",
      confidence: "medium",
    };
  }
  return {
    patch_type: "clarify_assignment",
    text: cleanAnswer,
    source_quote: cleanAnswer,
    answer_text: cleanAnswer,
    task_scope: task.targetScope,
    expected_outcome: task.expectedOutcome,
    target_summary: summarizeProposalTarget(task),
    rationale: "Needs a clearer target before canonical update.",
    confidence: "low",
    status: "pending_review",
    needs_user_confirmation: true,
  };
}

function parseProposalPatchForType(type: EnrichmentProposalType, value: unknown) {
  if (type === "create_evidence") return parseCreateEvidenceProposalPatch(value);
  if (type === "update_evidence") return parseEvidenceUpdateProposalPatch(value);
  if (type === "update_initiative") return parseStructuredStoryProposalPatch(value);
  if (type === "update_work_experience") return parseStructuredRoleProposalPatch(value);
  if (type === "clarify_assignment") return parseClarifyAssignmentProposalPatch(value);
  return null;
}

function getProposalPatchPreviewText(patch: EnrichmentProposalPatch) {
  if ("text" in patch) return patch.text;
  if ("text_patch" in patch && patch.text_patch) return patch.text_patch;
  if ("context_patch" in patch && patch.context_patch) return patch.context_patch;
  if ("summary_patch" in patch && patch.summary_patch) return patch.summary_patch;
  if ("problem_patch" in patch && patch.problem_patch) return patch.problem_patch;
  if ("role_patch" in patch && patch.role_patch) return patch.role_patch;
  if ("public_safe_summary_patch" in patch && patch.public_safe_summary_patch) {
    return patch.public_safe_summary_patch;
  }
  return patch.rationale;
}

function getProposalPatchSourceQuote(patch: EnrichmentProposalPatch) {
  if ("source_quote" in patch) return patch.source_quote;
  if ("source_quote_patch" in patch) return patch.source_quote_patch ?? null;
  return null;
}

function applyRevisedTextToProposalPatch(
  patch: EnrichmentProposalPatch,
  revisedText: string,
  sourceQuote: string,
): EnrichmentProposalPatch {
  if ("evidence_type" in patch) {
    return { ...patch, text: revisedText, source_quote: sourceQuote };
  }
  if ("patch_type" in patch && patch.patch_type === "update_evidence") {
    return { ...patch, text_patch: revisedText, source_quote_patch: patch.source_quote_patch ?? sourceQuote };
  }
  if ("patch_type" in patch && patch.patch_type === "update_initiative") {
    return { ...patch, context_patch: revisedText };
  }
  if ("patch_type" in patch && patch.patch_type === "update_work_experience") {
    return { ...patch, summary_patch: revisedText };
  }
  if ("patch_type" in patch && patch.patch_type === "clarify_assignment") {
    return {
      ...patch,
      text: revisedText,
      source_quote: sourceQuote,
      answer_text: revisedText,
    };
  }
  return patch;
}

function resumeSafeNoteForProposalType(type: EnrichmentProposalType) {
  if (type === "create_evidence") {
    return "Saving creates a draft evidence item. Resume-safe approval still requires review.";
  }
  if (type === "update_evidence") {
    return "Saving updates the evidence draft. Resume-safe approval still requires review.";
  }
  if (type === "update_initiative") {
    return "Saving updates story context. Resume evidence still depends on approved supporting claims.";
  }
  if (type === "update_work_experience") {
    return "Saving updates role context. Resume evidence still depends on approved supporting claims.";
  }
  return "Saving keeps this as context until a target is assigned.";
}

function summarizeProposalTarget(task: typeof enrichmentTasks.$inferSelect) {
  if (task.evidenceItemId) return "Existing evidence claim";
  if (task.initiativeId) return "Project or story";
  if (task.portfolioProjectId) return "Standalone portfolio project";
  if (task.workExperienceId) return "Role-level experience";
  return "Assign later";
}

async function extractEnrichmentAnswerEvidence(args: {
  sourceId: string;
  sourceText: string;
}) {
  const config = resolveJobDeskAiConfig();
  if (!config.providerEnabled || !config.apiKey) return null;

  try {
    const result = await extractProfileEvidenceWithAi({
      sourceId: args.sourceId,
      sourceText: args.sourceText,
      sourceKind: "project_note",
    });
    return {
      extraction: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      skill: result.skill,
    };
  } catch (error) {
    await persistEnrichmentExtractionFailure({
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      errorKind: error instanceof JobDeskAiError ? error.kind : "unknown",
      errorMessage:
        error instanceof Error ? error.message : "Unknown enrichment extraction error.",
      retryCount: error instanceof JobDeskAiError ? error.retryCount : 0,
      skill: skillRegistry.profileEvidenceExtractionProjectNote,
    });
    return null;
  }
}

async function persistEnrichmentExtractionFailure(args: {
  provider: string;
  model: string;
  errorKind: JobDeskAiFailureKind | "unknown";
  errorMessage: string;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}) {
  if (!hasDatabaseUrl()) return;
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  await db.insert(workflowRuns).values({
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
  });
}

function buildFallbackEvidenceDraft(
  content: string,
): ProfileEvidenceExtraction["evidence_items"][number] {
  return {
    text: content,
    source_quote: content,
    evidence_type: "user_confirmed",
    metrics: [],
    sensitivity_level: "private",
    allowed_usage: ["resume", "interview", "cover_letter"],
    public_safe_summary: null,
    status: "pending",
    related_project_id: null,
    related_work_experience_id: null,
    related_initiative_id: null,
    related_portfolio_project_id: null,
    needs_user_confirmation: true,
  };
}

function evaluateEnrichmentEvidenceGuardrails(
  item: ProfileEvidenceExtraction["evidence_items"][number],
  sourceText: string,
) {
  const quoteFound = sourceText.includes(item.source_quote);
  const groundedMetrics = item.metrics.filter((metric) =>
    sourceText.includes(metric.source_quote) &&
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

async function validateReusableLibraryAnchor(
  db: Pick<DbHandle, "select">,
  args: {
    anchor: ReusableLibraryAnchor;
    workspaceId: string;
  },
):
  Promise<
    | { status: "valid"; anchor: ReusableLibraryAnchor }
    | {
        status: "invalid";
        reason:
          | "evidence_item_not_found"
          | "initiative_not_found"
          | "portfolio_project_not_found"
          | "work_experience_not_found";
      }
  > {
  const anchor = normalizeReusableLibraryAnchor(args.anchor);
  if (anchor.evidenceItemId) {
    const [item] = await db
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(
        and(
          eq(evidenceItems.workspaceId, args.workspaceId),
          eq(evidenceItems.id, anchor.evidenceItemId),
        ),
      )
      .limit(1);
    if (!item) return { status: "invalid", reason: "evidence_item_not_found" };
  }
  if (anchor.initiativeId) {
    const [item] = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(and(eq(initiatives.workspaceId, args.workspaceId), eq(initiatives.id, anchor.initiativeId)))
      .limit(1);
    if (!item) return { status: "invalid", reason: "initiative_not_found" };
  }
  if (anchor.portfolioProjectId) {
    const [item] = await db
      .select({ id: portfolioProjects.id })
      .from(portfolioProjects)
      .where(
        and(
          eq(portfolioProjects.workspaceId, args.workspaceId),
          eq(portfolioProjects.id, anchor.portfolioProjectId),
        ),
      )
      .limit(1);
    if (!item) return { status: "invalid", reason: "portfolio_project_not_found" };
  }
  if (anchor.workExperienceId) {
    const [item] = await db
      .select({ id: workExperiences.id })
      .from(workExperiences)
      .where(
        and(
          eq(workExperiences.workspaceId, args.workspaceId),
          eq(workExperiences.id, anchor.workExperienceId),
        ),
      )
      .limit(1);
    if (!item) return { status: "invalid", reason: "work_experience_not_found" };
  }
  return { status: "valid", anchor };
}

function normalizeReusableLibraryAnchor(anchor: ReusableLibraryAnchor): ReusableLibraryAnchor {
  return {
    evidenceItemId: anchor.evidenceItemId ?? null,
    initiativeId: anchor.initiativeId ?? null,
    portfolioProjectId: anchor.initiativeId ? null : anchor.portfolioProjectId ?? null,
    workExperienceId: anchor.workExperienceId ?? null,
  };
}

export function normalizeReusableLibraryAnchorForTest(anchor: ReusableLibraryAnchor) {
  return normalizeReusableLibraryAnchor(anchor);
}

function hasReusableLibraryAnchor(anchor: ReusableLibraryAnchor) {
  return Boolean(
    anchor.evidenceItemId ||
      anchor.initiativeId ||
      anchor.portfolioProjectId ||
      anchor.workExperienceId,
  );
}

function pickBestAnchorForTask<T extends ReusableLibraryAnchor & { text: string; sourceQuote?: string | null }>(
  prompt: string,
  anchors: T[],
) {
  if (isBroadProfilePositioningQuestion(prompt)) return null;
  let best = anchors[0]!;
  let bestScore = -1;
  for (const anchor of anchors) {
    const score = scoreAnchorForTask(prompt, anchor);
    if (score > bestScore) {
      best = anchor;
      bestScore = score;
    }
  }
  return best;
}

export function isBroadProfilePositioningQuestion(prompt: string) {
  const text = normalizeText(prompt);
  const hasPositioningIntent =
    /\b(future|target|preferred|preference|emphasize|emphasized|highlight|positioning|direction|strongest|most recent|recent|prioritize|focus)\b/.test(
      text,
    );
  const hasProfileSubject =
    /\b(skills?|technical skills?|skills section|listed skills?|profile|career|software engineering roles?|engineering roles?|role direction|target roles?)\b/.test(
      text,
    );
  const asksForChoice =
    /\b(which|what|where|how|would you|do you want|should)\b/.test(text);
  const explicitlyBroad =
    /\b(future roles?|future software engineering roles?|career direction|general profile|profile positioning|technical skills section)\b/.test(
      text,
    );

  return explicitlyBroad || (hasPositioningIntent && hasProfileSubject && asksForChoice);
}

function getProfileContextTaskDefaults() {
  return {
    targetScope: "profile_context" as const,
    targetConfidence: "low" as const,
    targetReason:
      "This is a profile-level positioning preference, not a claim-specific evidence gap.",
    expectedOutcome: "save_profile_answer" as const,
  };
}

function scoreAnchorForTask(
  prompt: string,
  anchor: ReusableLibraryAnchor & { text: string; sourceQuote?: string | null },
) {
  const promptTokens = new Set(toTaskTokens(prompt));
  const textTokens = new Set(toTaskTokens(`${anchor.text} ${anchor.sourceQuote ?? ""}`));
  let overlap = 0;
  for (const token of promptTokens) {
    if (textTokens.has(token)) overlap += 1;
  }
  const typeBonus = anchor.evidenceItemId
    ? 4
    : anchor.initiativeId || anchor.portfolioProjectId
      ? 2
      : 1;
  return overlap * 3 + typeBonus;
}

function toTaskTokens(value: string) {
  const stopWords = new Set([
    "about",
    "after",
    "before",
    "could",
    "from",
    "have",
    "more",
    "that",
    "their",
    "this",
    "with",
    "your",
  ]);
  return value
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

export async function getOpenEnrichmentTaskCountsByEvidenceIds(evidenceIds: string[]) {
  if (!hasDatabaseUrl() || evidenceIds.length === 0) return new Map<string, number>();
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select({
      evidenceItemId: enrichmentTasks.evidenceItemId,
    })
    .from(enrichmentTasks)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, workspace.id),
        inArray(enrichmentTasks.evidenceItemId, evidenceIds),
        inArray(enrichmentTasks.status, ["open", "answered"]),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.evidenceItemId) continue;
    counts.set(row.evidenceItemId, (counts.get(row.evidenceItemId) ?? 0) + 1);
  }
  return counts;
}

function normalizeTaskDraft(task: EnrichmentTaskDraft) {
  const prompt = task.prompt.trim();
  const sourceLabel = task.sourceLabel.trim();
  if (!prompt || !sourceLabel) return null;
  return {
    ...task,
    prompt,
    sourceLabel,
  };
}

function buildEnrichmentDedupeKey(task: EnrichmentTaskDraft) {
  const basis = [
    task.sourceType,
    task.resumeReviewReportId ?? "",
    normalizeText(task.sourceLabel),
    task.resumeSourceVersionId ?? "",
    task.evidenceItemId ?? "",
    task.workExperienceId ?? "",
    task.initiativeId ?? "",
    task.portfolioProjectId ?? "",
    normalizeText(task.prompt),
  ].join("|");
  return crypto.createHash("sha256").update(basis).digest("hex");
}

function classifyEnrichmentTask(prompt: string): EnrichmentTaskType {
  if (isImportedMaterialReviewNote(prompt)) {
    return "source_section_review";
  }
  return classifyEnrichmentTaskAsQuestion(prompt);
}

function classifyEnrichmentTaskAsQuestion(prompt: string): EnrichmentTaskType {
  const text = prompt.toLowerCase();
  if (/\b(metric|measure|number|percent|%|revenue|cost|latency|volume)\b/.test(text)) {
    return "metric";
  }
  if (/\b(scope|scale|size|team|users|customers|traffic)\b/.test(text)) {
    return "scope";
  }
  if (/\b(owner|ownership|led|responsible|role|contribution)\b/.test(text)) {
    return "ownership";
  }
  if (/\b(technical|architecture|system|stack|implementation|algorithm)\b/.test(text)) {
    return "technical_depth";
  }
  if (/\b(stakeholder|partner|cross-functional|customer|manager)\b/.test(text)) {
    return "stakeholder";
  }
  if (/\b(result|impact|outcome|improved|reduced|increased)\b/.test(text)) {
    return "impact";
  }
  if (/\b(public|external|safe|confidential|redact)\b/.test(text)) {
    return "public_safe_wording";
  }
  return "star";
}

function isSourceSectionExtractionNote(prompt: string) {
  const text = normalizeText(prompt);
  return (
    /\b(entries|items|details)\s+were\s+extracted\s+from\s+the\s+.+\s+section\b/.test(text) ||
    /\b.+\s+was\s+extracted\s+from\s+the\s+.+\s+section\b/.test(text)
  );
}

function isImportedMaterialReviewNote(prompt: string) {
  const text = normalizeText(prompt);
  return (
    isSourceSectionExtractionNote(prompt) ||
    /\breturned\s+at\s+most\s+\d+\b/.test(text) ||
    /\bomitted\s+additional\b/.test(text) ||
    /\bclassified\s+as\s+[a-z_]+\s+because\b/.test(text) ||
    /\bnot\s+under\s+an\s+employer\b/.test(text) ||
    /\bnot\s+user-facing\b/.test(text) ||
    /\bcapped\s+at\s+\d+\b/.test(text)
  );
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function getTaskTargetMap(
  db: Pick<DbHandle, "select">,
  taskIds: string[],
) {
  if (taskIds.length === 0) return new Map<string, EnrichmentTaskTargetPayload[]>();
  const rows = await db
    .select()
    .from(enrichmentTaskTargets)
    .where(inArray(enrichmentTaskTargets.taskId, taskIds));
  const map = new Map<string, EnrichmentTaskTargetPayload[]>();
  for (const row of rows) {
    const targets = map.get(row.taskId) ?? [];
    targets.push({
      target_kind: row.targetKind,
      target_id: row.targetId,
      target_role: row.targetRole,
      confidence: row.confidence,
      accepted_at: row.acceptedAt?.toISOString() ?? null,
      created_by: row.createdBy,
      reason: row.reason,
      rejected_at: row.rejectedAt?.toISOString() ?? null,
    });
    map.set(row.taskId, targets);
  }
  return map;
}

async function getTaskProposalMap(
  db: Pick<DbHandle, "select">,
  taskIds: string[],
) {
  if (taskIds.length === 0) return new Map<string, EnrichmentProposalPayload[]>();
  const rows = await db
    .select()
    .from(enrichmentProposals)
    .where(inArray(enrichmentProposals.taskId, taskIds))
    .orderBy(
      sql`case when ${enrichmentProposals.status} = 'pending_review' then 0 else 1 end`,
      desc(enrichmentProposals.updatedAt),
    );
  const map = new Map<string, EnrichmentProposalPayload[]>();
  for (const row of rows) {
    const proposals = map.get(row.taskId) ?? [];
    proposals.push(toEnrichmentProposalPayload(row));
    map.set(row.taskId, proposals);
  }
  return map;
}

function toEnrichmentProposalPayload(
  proposal: typeof enrichmentProposals.$inferSelect,
): EnrichmentProposalPayload {
  return {
    id: proposal.id,
    proposal_type: proposal.proposalType,
    status: proposal.status,
    target_kind: proposal.targetKind,
    target_id: proposal.targetId,
    schema_version: proposal.schemaVersion,
    proposed_patch_json: proposal.proposedPatchJson,
    evidence_delta_json: proposal.evidenceDeltaJson ?? null,
    committed_evidence_item_id: proposal.committedEvidenceItemId,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
    reviewedAt: proposal.reviewedAt?.toISOString() ?? null,
  };
}

async function getTaskProposalRevisionMap(
  db: Pick<DbHandle, "select">,
  taskIds: string[],
) {
  if (taskIds.length === 0) return new Map<string, EnrichmentProposalRevisionPayload[]>();
  let rows: Array<typeof enrichmentProposalRevisions.$inferSelect>;
  try {
    rows = await db
      .select()
      .from(enrichmentProposalRevisions)
      .where(inArray(enrichmentProposalRevisions.taskId, taskIds))
      .orderBy(enrichmentProposalRevisions.createdAt);
  } catch (error) {
    if (isMissingProposalRevisionsTableError(error)) {
      console.warn(
        "[enrichment] proposal revision history table is unavailable; returning tasks without revision history",
      );
      return new Map<string, EnrichmentProposalRevisionPayload[]>();
    }
    throw error;
  }
  const map = new Map<string, EnrichmentProposalRevisionPayload[]>();
  for (const row of rows) {
    const revisions = map.get(row.taskId) ?? [];
    revisions.push({
      id: row.id,
      proposal_id: row.proposalId,
      next_proposal_id: row.nextProposalId,
      actor: row.actor,
      mode: row.mode,
      instruction: row.instruction,
      previous_text: row.previousText,
      revised_text: row.revisedText,
      createdAt: row.createdAt.toISOString(),
    });
    map.set(row.taskId, revisions);
  }
  return map;
}

function isMissingProposalRevisionsTableError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    code === "42P01" ||
    /enrichment_proposal_revisions/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

async function replaceTaskTargets(
  db: Pick<DbHandle, "delete" | "insert">,
  args: {
    workspaceId: string;
    taskId: string;
    anchor: ReusableLibraryAnchor;
    confidence: EnrichmentTaskTargetConfidence;
    createdBy?: "system" | "ai" | "user";
    reason: string;
    targetRole?: EnrichmentTaskTargetRole;
  },
) {
  await db
    .delete(enrichmentTaskTargets)
    .where(eq(enrichmentTaskTargets.taskId, args.taskId));
  const targets = buildTargetRows(args.anchor, {
    confidence: args.confidence,
    createdBy: args.createdBy ?? "user",
    reason: args.reason,
    taskId: args.taskId,
    targetRole: args.targetRole ?? "primary",
    workspaceId: args.workspaceId,
  });
  if (targets.length === 0) return [];
  return db.insert(enrichmentTaskTargets).values(targets).returning();
}

function buildTargetRows(
  anchor: ReusableLibraryAnchor,
  args: {
    confidence: EnrichmentTaskTargetConfidence;
    createdBy?: "system" | "ai" | "user";
    reason: string;
    taskId: string;
    targetRole?: EnrichmentTaskTargetRole;
    workspaceId: string;
  },
) {
  const rows: Array<typeof enrichmentTaskTargets.$inferInsert> = [];
  const primaryRole = args.targetRole ?? "primary";
  const add = (targetKind: EnrichmentTaskTargetKind, targetId?: string | null) => {
    if (!targetId) return;
    rows.push({
      workspaceId: args.workspaceId,
      taskId: args.taskId,
      targetKind,
      targetId,
      targetRole: rows.length === 0 ? primaryRole : "parent",
      confidence: args.confidence,
      createdBy: args.createdBy ?? "system",
      acceptedAt: primaryRole === "primary" && rows.length === 0 ? new Date() : null,
      reason: args.reason,
    });
  };
  add("evidence", anchor.evidenceItemId);
  add("initiative", anchor.initiativeId);
  add("portfolio_project", anchor.portfolioProjectId);
  add("work_experience", anchor.workExperienceId);
  return rows;
}

function deriveTaskTargetMetadata(
  task: EnrichmentTaskDraft | ReusableLibraryAnchor,
  reason?: string,
): {
  targetScope: EnrichmentTaskTargetScope;
  targetConfidence: EnrichmentTaskTargetConfidence;
  targetReason: string;
  expectedOutcome: EnrichmentTaskExpectedOutcome;
} {
  const explicitTask = "taskType" in task ? task : null;
  if ("taskType" in task && task.taskType === "source_section_review") {
    return {
      targetScope: task.targetScope ?? "source_material",
      targetConfidence: task.targetConfidence ?? "high",
      targetReason:
        task.targetReason ??
        reason ??
        "This is an extraction note for imported source material, not a missing-information question.",
      expectedOutcome: task.expectedOutcome ?? "review_imported_material",
    };
  }
  const anchor = task;
  if (anchor.evidenceItemId) {
    return {
      targetScope: explicitTask?.targetScope ?? "evidence_detail",
      targetConfidence: explicitTask?.targetConfidence ?? "medium",
      targetReason:
        explicitTask?.targetReason ??
        reason ??
        "This question is attached to a specific evidence claim.",
      expectedOutcome: explicitTask?.expectedOutcome ?? "update_evidence",
    };
  }
  if (anchor.initiativeId || anchor.portfolioProjectId) {
    return {
      targetScope: explicitTask?.targetScope ?? "story_context",
      targetConfidence: explicitTask?.targetConfidence ?? "medium",
      targetReason:
        explicitTask?.targetReason ??
        reason ??
        "This question is attached to a project or story.",
      expectedOutcome: explicitTask?.expectedOutcome ?? "update_story",
    };
  }
  if (anchor.workExperienceId) {
    return {
      targetScope: explicitTask?.targetScope ?? "role_context",
      targetConfidence: explicitTask?.targetConfidence ?? "medium",
      targetReason:
        explicitTask?.targetReason ??
        reason ??
        "This question is attached to a role-level experience.",
      expectedOutcome: explicitTask?.expectedOutcome ?? "update_role",
    };
  }
  return {
    targetScope: explicitTask?.targetScope ?? "assign_later",
    targetConfidence: explicitTask?.targetConfidence ?? "low",
    targetReason:
      explicitTask?.targetReason ?? reason ?? "No reusable library target is attached yet.",
    expectedOutcome: explicitTask?.expectedOutcome ?? "route_answer",
  };
}

export function deriveEnrichmentTaskTargetMetadataForTest(
  task: EnrichmentTaskDraft | ReusableLibraryAnchor,
  reason?: string,
) {
  return deriveTaskTargetMetadata(task, reason);
}

function toEnrichmentTaskPayload(
  task: typeof enrichmentTasks.$inferSelect,
  targets: EnrichmentTaskTargetPayload[] = [],
  proposals: EnrichmentProposalPayload[] = [],
  proposalRevisions: EnrichmentProposalRevisionPayload[] = [],
) {
  const fallbackTargets = targets.length > 0 ? targets : buildFallbackTargetPayloads(task);
  return {
    id: task.id,
    task_type: task.taskType,
    status: task.status,
    source_type: task.sourceType,
    source_label: task.sourceLabel,
    prompt: task.prompt,
    user_answer: task.userAnswer,
    target_scope: task.targetScope,
    target_confidence: task.targetConfidence,
    target_reason: task.targetReason,
    expected_outcome: task.expectedOutcome,
    note_kind: task.noteKind,
    expected_action: task.expectedAction,
    target_field: task.targetField,
    review_payload: task.reviewPayloadJson as EnrichmentTaskReviewPayload | null,
    targets: fallbackTargets,
    proposals,
    proposal_revisions: proposalRevisions,
    evidence_item_id: task.evidenceItemId,
    work_experience_id: task.workExperienceId,
    initiative_id: task.initiativeId,
    portfolio_project_id: task.portfolioProjectId,
    resume_source_version_id: task.resumeSourceVersionId,
    resume_review_report_id: task.resumeReviewReportId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    answeredAt: task.answeredAt?.toISOString() ?? null,
    convertedAt: task.convertedAt?.toISOString() ?? null,
    dismissedAt: task.dismissedAt?.toISOString() ?? null,
    acknowledgedAt: task.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: task.resolvedAt?.toISOString() ?? null,
    resolution_kind: task.resolutionKind,
  };
}

function buildFallbackTargetPayloads(
  task: typeof enrichmentTasks.$inferSelect,
): EnrichmentTaskTargetPayload[] {
  return buildTargetRows(
    {
      evidenceItemId: task.evidenceItemId,
      initiativeId: task.initiativeId,
      portfolioProjectId: task.portfolioProjectId,
      workExperienceId: task.workExperienceId,
    },
    {
      confidence: task.targetConfidence ?? "low",
      reason: task.targetReason ?? "Fallback from legacy destination fields.",
      taskId: task.id,
      workspaceId: task.workspaceId,
    },
  ).map((row) => ({
    target_kind: row.targetKind,
    target_id: row.targetId,
    target_role: row.targetRole ?? "primary",
    confidence: row.confidence ?? "low",
    accepted_at: null,
    created_by: row.createdBy ?? null,
    reason: row.reason ?? null,
    rejected_at: null,
  }));
}
