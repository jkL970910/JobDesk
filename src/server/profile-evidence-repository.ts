import crypto from "node:crypto";

import { desc, eq, inArray } from "drizzle-orm";

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
import type { AllowedUsage, FieldTier, SensitivityLevel } from "../schemas/shared";
import {
  retrieveResumeEvidenceForJob,
  type ResumeRetrievalJobContext,
} from "./retrieval-service";

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
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const patch: Partial<typeof evidenceItems.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (args.action === "approve") {
    patch.status = "approved";
    patch.needsUserConfirmation = 0;
  } else if (args.action === "approve_for_resume") {
    patch.status = "approved";
    patch.allowedUsage = Array.from(
      new Set([...(args.allowedUsage ?? []), "resume" as const]),
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
    patch.needsUserConfirmation = 1;
  }

  const [item] = await getDb()
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
