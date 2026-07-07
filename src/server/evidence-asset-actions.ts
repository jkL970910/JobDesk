import { and, eq, inArray } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  evidenceItems,
  generatedClaims,
  initiatives,
  portfolioProjects,
  projectCards,
  sourceCleanupEvents,
  workExperiences,
} from "../db/schema";
import { AllowedUsage, type SensitivityLevel } from "../schemas/shared";
import {
  buildRedactionReport,
  hasResumeSafeDisclosure,
  isPublicSafeText,
} from "./deidentification-service";
import { getCurrentWorkspace } from "./workspace-repository";

export type EvidenceAssetActionArgs = {
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
};

export type EvidenceQuarantineArgs = {
  evidenceId: string;
  confirmation: string;
  reason?: string | null;
};

const EVIDENCE_QUARANTINE_CONFIRMATION = "QUARANTINE_APPROVED_EVIDENCE";

export async function markEvidenceClaimsStaleForEvidenceIds(evidenceIds: string[]) {
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

export async function applyEvidenceAssetAction(args: EvidenceAssetActionArgs) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const patch: Partial<typeof evidenceItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  let redactionReport = null;
  const [existingActionTarget] = await db
    .select({
      id: evidenceItems.id,
      quarantinedAt: evidenceItems.quarantinedAt,
    })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.id, args.evidenceId)))
    .limit(1);
  if (!existingActionTarget) return { status: "not_found" as const };
  if (existingActionTarget.quarantinedAt) {
    return { status: "invalid" as const, reason: "quarantined_evidence_requires_restore" as const };
  }
  if (args.action === "edit" && args.relatedProjectId) {
    const validation = await validateEvidenceProjectLink({
      evidenceId: args.evidenceId,
      relatedProjectId: args.relatedProjectId,
      workspaceId: workspace.id,
    });
    if (validation.status !== "valid") return validation;
  }
  if (args.action === "edit") {
    const targetValidation = await validateEvidenceStoryLinks({
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
    await markEvidenceClaimsStaleForEvidenceIds([args.evidenceId]);
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

export async function quarantineEvidenceAsset(args: EvidenceQuarantineArgs) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  if (args.confirmation !== EVIDENCE_QUARANTINE_CONFIRMATION) {
    return { status: "invalid" as const, reason: "quarantine_confirmation_required" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [existing] = await db
    .select({
      allowedUsage: evidenceItems.allowedUsage,
      id: evidenceItems.id,
      needsUserConfirmation: evidenceItems.needsUserConfirmation,
      quarantinedAt: evidenceItems.quarantinedAt,
      sourceDocumentId: evidenceItems.sourceDocumentId,
      sourceQuote: evidenceItems.sourceQuote,
      status: evidenceItems.status,
      text: evidenceItems.text,
      workspaceId: evidenceItems.workspaceId,
    })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.id, args.evidenceId)))
    .limit(1);

  if (!existing) return { status: "not_found" as const };
  if (existing.quarantinedAt) {
    return { status: "invalid" as const, reason: "evidence_already_quarantined" as const };
  }
  if (!existing.sourceDocumentId) {
    return {
      status: "invalid" as const,
      reason: "quarantine_requires_source_derived_evidence" as const,
    };
  }
  if (existing.status !== "approved" && !existing.allowedUsage.includes("resume")) {
    return {
      status: "invalid" as const,
      reason: "quarantine_requires_protected_evidence" as const,
    };
  }

  const claims = await db
    .select({ id: generatedClaims.id, evidenceIds: generatedClaims.evidenceIds })
    .from(generatedClaims)
    .where(eq(generatedClaims.workspaceId, workspace.id));
  const impactedClaimIds = claims
    .filter((claim) => claim.evidenceIds.includes(existing.id))
    .map((claim) => claim.id);
  const now = new Date();
  const reason =
    args.reason?.trim() ||
    "Approved source-derived evidence was quarantined after source cleanup review.";

  const result = await db.transaction(async (tx) => {
    const staleClaims =
      impactedClaimIds.length > 0
        ? await tx
            .update(generatedClaims)
            .set({
              claimStatus: "stale",
              supportStatus: "unvalidated",
              staleReason: "Linked evidence was quarantined after source cleanup review.",
              lastValidatedAt: null,
            })
            .where(
              and(
                eq(generatedClaims.workspaceId, workspace.id),
                inArray(generatedClaims.id, impactedClaimIds),
              ),
            )
            .returning({ id: generatedClaims.id })
        : [];
    const [evidenceItem] = await tx
      .update(evidenceItems)
      .set({
        allowedUsage: [],
        needsUserConfirmation: 1,
        quarantineReason: reason,
        quarantinedAt: now,
        status: "rejected",
        updatedAt: now,
      })
      .where(and(eq(evidenceItems.workspaceId, workspace.id), eq(evidenceItems.id, existing.id)))
      .returning({
        id: evidenceItems.id,
        allowedUsage: evidenceItems.allowedUsage,
        needsUserConfirmation: evidenceItems.needsUserConfirmation,
        quarantineReason: evidenceItems.quarantineReason,
        quarantinedAt: evidenceItems.quarantinedAt,
        status: evidenceItems.status,
      });
    const [cleanupEvent] = await tx
      .insert(sourceCleanupEvents)
      .values({
        cleanupMode: "approved_material_quarantine",
        dryRun: 0,
        impactJson: {
          protectedEvidenceItemId: existing.id,
          previousAllowedUsage: existing.allowedUsage,
          previousNeedsUserConfirmation: existing.needsUserConfirmation === 1,
          previousStatus: existing.status,
          sourceDocumentId: existing.sourceDocumentId,
          staleGeneratedClaimCount: staleClaims.length,
        },
        initiator: "user",
        resultJson: {
          markedStaleIds: {
            generatedClaims: staleClaims.map((claim) => claim.id),
          },
          quarantinedEvidenceItemId: existing.id,
        },
        sourceDocumentId: existing.sourceDocumentId,
        workspaceId: workspace.id,
      })
      .returning({ id: sourceCleanupEvents.id });
    return { cleanupEvent, evidenceItem, staleClaims };
  });

  if (!result.evidenceItem) return { status: "not_found" as const };
  return {
    status: "saved" as const,
    cleanupEventId: result.cleanupEvent?.id ?? null,
    evidenceItem: {
      ...result.evidenceItem,
      needsUserConfirmation: result.evidenceItem.needsUserConfirmation === 1,
      quarantinedAt: result.evidenceItem.quarantinedAt?.toISOString() ?? null,
    },
    staleGeneratedClaims: result.staleClaims.length,
  };
}

async function validateEvidenceProjectLink(args: {
  evidenceId: string;
  relatedProjectId: string;
  workspaceId: string;
}) {
  const db = getDb();
  const [evidence] = await db
    .select({
      id: evidenceItems.id,
      workspaceId: evidenceItems.workspaceId,
    })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, args.workspaceId), eq(evidenceItems.id, args.evidenceId)))
    .limit(1);
  if (!evidence) return { status: "not_found" as const };

  const [project] = await db
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

  const db = getDb();
  const [evidence] = await db
    .select({
      id: evidenceItems.id,
      workspaceId: evidenceItems.workspaceId,
    })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.workspaceId, args.workspaceId), eq(evidenceItems.id, args.evidenceId)))
    .limit(1);
  if (!evidence) return { status: "not_found" as const };

  if (args.relatedWorkExperienceId) {
    const result = await validateWorkExperienceTarget({
      evidenceWorkspaceId: evidence.workspaceId,
      id: args.relatedWorkExperienceId,
      workspaceId: args.workspaceId,
    });
    if (result.status !== "valid") return result;
  }
  if (args.relatedInitiativeId) {
    const result = await validateInitiativeTarget({
      evidenceWorkspaceId: evidence.workspaceId,
      id: args.relatedInitiativeId,
      workspaceId: args.workspaceId,
    });
    if (result.status !== "valid") return result;
  }
  if (args.relatedPortfolioProjectId) {
    const result = await validatePortfolioProjectTarget({
      evidenceWorkspaceId: evidence.workspaceId,
      id: args.relatedPortfolioProjectId,
      workspaceId: args.workspaceId,
    });
    if (result.status !== "valid") return result;
  }
  return { status: "valid" as const };
}

async function validateWorkExperienceTarget(args: {
  evidenceWorkspaceId: string;
  id: string;
  workspaceId: string;
}) {
  const db = getDb();
  const [target] = await db
    .select({
      id: workExperiences.id,
      workspaceId: workExperiences.workspaceId,
      status: workExperiences.status,
    })
    .from(workExperiences)
    .where(and(eq(workExperiences.workspaceId, args.workspaceId), eq(workExperiences.id, args.id)))
    .limit(1);
  if (!target) return { status: "invalid" as const, reason: "related_work_experience_not_found" as const };
  if (target.status === "rejected") {
    return { status: "invalid" as const, reason: "related_work_experience_rejected" as const };
  }
  if (target.workspaceId !== args.evidenceWorkspaceId) {
    return { status: "invalid" as const, reason: "cross_workspace_work_experience_link" as const };
  }
  return { status: "valid" as const };
}

async function validateInitiativeTarget(args: {
  evidenceWorkspaceId: string;
  id: string;
  workspaceId: string;
}) {
  const db = getDb();
  const [target] = await db
    .select({
      id: initiatives.id,
      workspaceId: initiatives.workspaceId,
      status: initiatives.status,
    })
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, args.workspaceId), eq(initiatives.id, args.id)))
    .limit(1);
  if (!target) return { status: "invalid" as const, reason: "related_initiative_not_found" as const };
  if (target.status === "rejected") {
    return { status: "invalid" as const, reason: "related_initiative_rejected" as const };
  }
  if (target.workspaceId !== args.evidenceWorkspaceId) {
    return { status: "invalid" as const, reason: "cross_workspace_initiative_link" as const };
  }
  return { status: "valid" as const };
}

async function validatePortfolioProjectTarget(args: {
  evidenceWorkspaceId: string;
  id: string;
  workspaceId: string;
}) {
  const db = getDb();
  const [target] = await db
    .select({
      id: portfolioProjects.id,
      workspaceId: portfolioProjects.workspaceId,
      status: portfolioProjects.status,
    })
    .from(portfolioProjects)
    .where(and(eq(portfolioProjects.workspaceId, args.workspaceId), eq(portfolioProjects.id, args.id)))
    .limit(1);
  if (!target) return { status: "invalid" as const, reason: "related_portfolio_project_not_found" as const };
  if (target.status === "rejected") {
    return { status: "invalid" as const, reason: "related_portfolio_project_rejected" as const };
  }
  if (target.workspaceId !== args.evidenceWorkspaceId) {
    return { status: "invalid" as const, reason: "cross_workspace_portfolio_project_link" as const };
  }
  return { status: "valid" as const };
}
