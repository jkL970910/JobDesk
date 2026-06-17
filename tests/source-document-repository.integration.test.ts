import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import { getDb } from "../src/db/client";
import { evidenceItems, initiatives, resumeSourceVersions, sourceDocuments } from "../src/db/schema";
import {
  persistParsedSourceDocument,
  buildSourceContentHash,
} from "../src/server/source-document-repository";
import { persistProfileEvidenceExtraction } from "../src/server/profile-evidence-repository";
import { getCurrentWorkspace } from "../src/server/workspace-repository";
import type { ResumeSourceParseResult } from "../src/server/resume-source-parser";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";
import { and, eq } from "drizzle-orm";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("source document lifecycle integration", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("deduplicates parsed generic sources inside a workspace only", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `source-owner-${suffix}@example.com`,
      password: "Password123!",
    });
    const other = await registerUser({
      email: `source-other-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created" || other.status !== "created") {
      throw new Error("Expected test users to be created.");
    }

    const parsed = buildParsedSource(`Project notes ${suffix}`);
    const first = await runWithAuthContext(owner.user.id, () =>
      persistParsedSourceDocument({ sourceType: "project_note", parsed }),
    );
    expect(first).toMatchObject({ status: "saved" });
    const duplicate = await runWithAuthContext(owner.user.id, () =>
      persistParsedSourceDocument({ sourceType: "project_note", parsed }),
    );
    expect(duplicate).toMatchObject({ status: "duplicate" });
    const otherWorkspace = await runWithAuthContext(other.user.id, () =>
      persistParsedSourceDocument({ sourceType: "project_note", parsed }),
    );
    expect(otherWorkspace).toMatchObject({ status: "saved" });
  });

  it("stores parser metadata and does not create resume versions for project notes", async () => {
    const parsed = buildParsedSource(`Lifecycle project note ${Date.now()}`);
    const result = await persistParsedSourceDocument({
      sourceType: "project_note",
      parsed,
    });
    if (result.status !== "saved") throw new Error("Expected saved source document.");

    const db = getDb();
    const [sourceDocument] = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.id, result.sourceDocumentId))
      .limit(1);
    expect(sourceDocument).toMatchObject({
      sourceType: "project_note",
      parserName: "jobdesk-source-parser",
      parserVersion: "document-lifecycle-v1",
      parseStatus: "usable",
      lifecycleStatus: "parsed",
      originalFilename: parsed.originalFilename,
      charCount: parsed.parseQuality.charCount,
      wordCount: parsed.parseQuality.wordCount,
    });

    const resumes = await db
      .select()
      .from(resumeSourceVersions)
      .where(eq(resumeSourceVersions.sourceDocumentId, result.sourceDocumentId));
    expect(resumes).toHaveLength(0);
  });

  it("stores resume source lifecycle metadata when a resume version is created", async () => {
    const parsed = buildParsedSource(`Resume source ${Date.now()}`);
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const now = new Date();
    const [createdSource] = await db
      .insert(sourceDocuments)
      .values({
        workspaceId: workspace.id,
        sourceType: "resume-review",
        title: parsed.sourceTitle,
        originalFilename: parsed.originalFilename,
        mimeType: parsed.mimeType,
        fileSizeBytes: parsed.fileSizeBytes,
        contentText: parsed.sourceText,
        contentHash: buildSourceContentHash(parsed.sourceText),
        parserName: parsed.parserName,
        parserVersion: parsed.parserVersion,
        parseStatus: parsed.parseQuality.status,
        parseWarnings: parsed.parseQuality.warnings,
        charCount: parsed.parseQuality.charCount,
        wordCount: parsed.parseQuality.wordCount,
        lifecycleStatus: "reviewed",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: sourceDocuments.id });
    if (!createdSource) throw new Error("Expected source document.");
    const [createdResume] = await db
      .insert(resumeSourceVersions)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: createdSource.id,
        title: parsed.sourceTitle,
        contentHash: `${parsed.sourceTitle}-${Date.now()}`,
        sourceKind: parsed.sourceKind,
        sourceText: parsed.sourceText,
        version: 1,
        status: "reviewed",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: resumeSourceVersions.id });
    expect(createdResume?.id).toBeTruthy();

    const [sourceDocument] = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.contentHash, buildSourceContentHash(parsed.sourceText)))
      .limit(1);
    expect(sourceDocument).toMatchObject({
      workspaceId: workspace.id,
      sourceType: "resume-review",
      lifecycleStatus: "reviewed",
      parseStatus: "usable",
    });
  });

  it("reuses a parsed source document when extraction persists evidence", async () => {
    const parsed = buildParsedSource(`Reusable parsed source ${Date.now()}`);
    const parsedSource = await persistParsedSourceDocument({
      sourceType: "project_note",
      parsed,
    });
    if (parsedSource.status !== "saved") {
      throw new Error("Expected saved parsed source.");
    }

    const persistence = await persistProfileEvidenceExtraction({
      sourceText: parsed.sourceText,
      sourceTitle: parsed.sourceTitle,
      sourceDocumentId: parsedSource.sourceDocumentId,
      sourceType: "project-note",
      extraction: buildExtraction(parsed.sourceTitle),
      provider: "test-provider",
      model: "test-model",
      usage: { totalTokens: 0 },
      retryCount: 0,
      skill: {
        modelTier: "cheap",
        promptVersion: "test-prompt",
        schemaName: "ProfileEvidenceExtraction",
        schemaVersion: "test-schema",
        skillId: "profile-evidence-extraction-project-note",
        skillVersion: "test-skill",
        sourceSkillIds: ["profile-extraction", "evidence-extraction"],
        workflowType: "profile-evidence-extraction",
      },
    });

    expect(persistence).toMatchObject({
      status: "saved",
      sourceDocumentId: parsedSource.sourceDocumentId,
    });
    const db = getDb();
    const matchingSources = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.contentHash, buildSourceContentHash(parsed.sourceText)));
    expect(matchingSources).toHaveLength(1);
    expect(matchingSources[0]).toMatchObject({
      id: parsedSource.sourceDocumentId,
      lifecycleStatus: "extracted",
      sourceType: "project-note",
    });
  });

  it("links extracted evidence back to a selected enrichment target", async () => {
    const parsed = buildParsedSource(`Target-aware enrichment ${Date.now()}`);
    const parsedSource = await persistParsedSourceDocument({
      sourceType: "project_note",
      parsed,
    });
    if (parsedSource.status !== "saved") {
      throw new Error("Expected saved parsed source.");
    }

    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const [target] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: parsedSource.sourceDocumentId,
        internalTitle: "Target activation story",
        externalSafeTitle: "Target activation story",
        context: "Existing thin initiative context.",
        problem: null,
        role: null,
        actions: [],
        results: [],
        metrics: [],
        technologies: [],
        stakeholders: [],
        status: "pending",
      })
      .returning({ id: initiatives.id });
    if (!target) throw new Error("Expected target initiative.");

    const persistence = await persistProfileEvidenceExtraction({
      sourceText: parsed.sourceText,
      sourceTitle: parsed.sourceTitle,
      sourceDocumentId: parsedSource.sourceDocumentId,
      sourceType: "project-note",
      target: {
        missingFields: ["metrics"],
        targetId: target.id,
        targetTitle: "Target activation story",
        targetType: "initiative",
      },
      extraction: buildExtraction(parsed.sourceTitle),
      provider: "test-provider",
      model: "test-model",
      usage: { totalTokens: 0 },
      retryCount: 0,
      skill: {
        modelTier: "cheap",
        promptVersion: "test-prompt",
        schemaName: "ProfileEvidenceExtraction",
        schemaVersion: "test-schema",
        skillId: "profile-evidence-extraction-project-note",
        skillVersion: "test-skill",
        sourceSkillIds: ["profile-extraction", "evidence-extraction"],
        workflowType: "profile-evidence-extraction",
      },
    });
    expect(persistence).toMatchObject({ status: "saved" });

    const linkedEvidence = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.relatedInitiativeId, target.id));
    expect(linkedEvidence.length).toBeGreaterThan(0);
    expect(linkedEvidence.every((item) => item.workspaceId === workspace.id)).toBe(true);
  });

  it("prefers the selected enrichment target over a newly generated duplicate target", async () => {
    const parsed = buildParsedSource(`Duplicate-target enrichment ${Date.now()}`);
    const parsedSource = await persistParsedSourceDocument({
      sourceType: "project_note",
      parsed,
    });
    if (parsedSource.status !== "saved") {
      throw new Error("Expected saved parsed source.");
    }

    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const [selectedTarget] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: parsedSource.sourceDocumentId,
        internalTitle: "Selected thin story",
        externalSafeTitle: "Selected thin story",
        context: "Existing thin story from resume review.",
        problem: null,
        role: null,
        actions: [],
        results: [],
        metrics: [],
        technologies: [],
        stakeholders: [],
        status: "pending",
      })
      .returning({ id: initiatives.id });
    if (!selectedTarget) throw new Error("Expected selected target.");

    const generatedTitle = `Generated duplicate story ${Date.now()}`;
    const extraction = buildExtractionWithGeneratedInitiative(generatedTitle);
    const persistence = await persistProfileEvidenceExtraction({
      sourceText: parsed.sourceText,
      sourceTitle: parsed.sourceTitle,
      sourceDocumentId: parsedSource.sourceDocumentId,
      sourceType: "project-note",
      target: {
        missingFields: ["metrics", "results"],
        targetId: selectedTarget.id,
        targetTitle: "Selected thin story",
        targetType: "initiative",
      },
      extraction,
      provider: "test-provider",
      model: "test-model",
      usage: { totalTokens: 0 },
      retryCount: 0,
      skill: {
        modelTier: "cheap",
        promptVersion: "test-prompt",
        schemaName: "ProfileEvidenceExtraction",
        schemaVersion: "test-schema",
        skillId: "profile-evidence-extraction-project-note",
        skillVersion: "test-skill",
        sourceSkillIds: ["profile-extraction", "evidence-extraction"],
        workflowType: "profile-evidence-extraction",
      },
    });
    expect(persistence).toMatchObject({ status: "saved" });

    const selectedEvidence = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.relatedInitiativeId, selectedTarget.id));
    expect(selectedEvidence.length).toBeGreaterThan(0);

    const generatedTargets = await db
      .select()
      .from(initiatives)
      .where(
        and(
          eq(initiatives.workspaceId, workspace.id),
          eq(initiatives.internalTitle, generatedTitle),
        ),
      );
    expect(generatedTargets).toHaveLength(0);

    const [updatedTarget] = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, selectedTarget.id))
      .limit(1);
    expect(updatedTarget).toMatchObject({
      problem: "Duplicate target problem.",
      role: "Owner",
    });
    expect(updatedTarget?.actions).toContain("Built dashboards.");
    expect(updatedTarget?.results).toContain("Reduced manual reporting effort.");
    expect(updatedTarget?.technologies).toContain("SQL");
    expect(updatedTarget?.stakeholders).toContain("product team");

    const allEvidence = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.sourceDocumentId, parsedSource.sourceDocumentId));
    expect(allEvidence.every((item) => item.relatedInitiativeId === selectedTarget.id)).toBe(true);
  });
});

function buildParsedSource(title: string): ResumeSourceParseResult {
  const sourceText = [
    title,
    "Built onboarding analytics dashboards with SQL and product event data.",
    "Led stakeholder readouts, clarified funnel health, and documented decisions.",
    "Created reusable project summaries, metrics, ownership context, and resume-safe wording.",
  ].join("\n");
  const wordCount = sourceText.trim().split(/\s+/).filter(Boolean).length;
  return {
    sourceTitle: `${title}.txt`,
    sourceText,
    sourceKind: "text",
    warnings: [],
    parseQuality: {
      status: "usable",
      charCount: sourceText.length,
      wordCount,
      warnings: [],
    },
    parserName: "jobdesk-source-parser",
    parserVersion: "document-lifecycle-v1",
    originalFilename: `${title}.txt`,
    mimeType: "text/plain",
    fileSizeBytes: Buffer.byteLength(sourceText),
  };
}

function buildExtraction(title: string): ProfileEvidenceExtraction {
  return {
    profile: {
      name: { value: "Test User", confidence: 0.9, source_quote: "Test User" },
      email: null,
      phone: null,
      location: null,
      links: [],
      skills: [],
      education: [],
      certifications: [],
      experience: [],
      missing_fields: [],
      low_confidence_fields: [],
      invented_field_flags: [],
    },
    work_experiences: [],
    initiatives: [],
    portfolio_projects: [],
    project_cards: [],
    evidence_items: [
      {
        text: "Built onboarding analytics dashboards with SQL and product event data.",
        evidence_type: "extracted",
        status: "pending",
        source_quote: "Built onboarding analytics dashboards with SQL and product event data.",
        metrics: [],
        sensitivity_level: "public_safe",
        allowed_usage: ["resume"],
        needs_user_confirmation: true,
        public_safe_summary: "Built onboarding analytics dashboards with SQL and product event data.",
        related_project_id: null,
      },
    ],
    extraction_notes: [],
  };
}

function buildExtractionWithGeneratedInitiative(title: string): ProfileEvidenceExtraction {
  return {
    ...buildExtraction(title),
    initiatives: [
      {
        internal_title: title,
        external_safe_title: title,
        work_experience_ref: null,
        context: "Generated duplicate target from enrichment answer.",
        problem: "Duplicate target problem.",
        role: "Owner",
        actions: ["Built dashboards."],
        results: ["Reduced manual reporting effort."],
        metrics: [],
        technologies: ["SQL"],
        stakeholders: ["product team"],
        external_safe_summary: null,
        sensitivity_level: "private",
        needs_redaction_review: false,
        status: "pending",
      },
    ],
    evidence_items: [
      {
        text: "Built onboarding analytics dashboards with SQL and product event data.",
        evidence_type: "extracted",
        status: "pending",
        source_quote: "Built onboarding analytics dashboards with SQL and product event data.",
        metrics: [],
        sensitivity_level: "public_safe",
        allowed_usage: ["resume"],
        needs_user_confirmation: true,
        public_safe_summary: "Built onboarding analytics dashboards with SQL and product event data.",
        related_project_id: null,
        related_initiative_id: title,
      },
    ],
  };
}
