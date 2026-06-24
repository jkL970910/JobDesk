import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import { getDb } from "../src/db/client";
import {
  embeddings,
  evidenceItems,
  initiatives,
  resumeSourceVersions,
  sourceChunks,
  sourceDocuments,
  workExperiences,
} from "../src/db/schema";
import {
  persistParsedSourceDocument,
  buildSourceContentHash,
} from "../src/server/source-document-repository";
import {
  createWorkExperienceAndAssignInitiative,
  persistProfileEvidenceExtraction,
  getResumeTailoringContext,
  updateEvidenceItem,
} from "../src/server/profile-evidence-repository";
import { getCurrentWorkspace } from "../src/server/workspace-repository";
import type { ResumeSourceParseResult } from "../src/server/resume-source-parser";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";
import { and, eq, inArray } from "drizzle-orm";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";
import { syncPersonalEmbeddings } from "../src/server/embedding-service";
import {
  buildResumeRetrievalContextFromQuery,
  retrieveSourceMaterialForEvidenceGaps,
} from "../src/server/retrieval-service";

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

  it("indexes source chunks as evidence-gap material without making them resume evidence", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `source-chunk-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected test user.");

    await runWithAuthContext(owner.user.id, async () => {
      const parsed = buildParsedSource(
        `Activation source chunk ${suffix}`,
        [
          "Built onboarding activation dashboards with SQL and event taxonomy data.",
          "Captured retention cohort questions that still need evidence extraction.",
          "Partnered with product and engineering on launch analytics instrumentation.",
        ].join(" "),
      );
      const saved = await persistParsedSourceDocument({
        sourceType: "work_summary",
        parsed,
      });
      if (saved.status !== "saved") throw new Error("Expected saved source.");

      const sync = await syncPersonalEmbeddings();
      expect(sync).toMatchObject({ status: "saved" });
      if (sync.status !== "saved") throw new Error("Expected saved embeddings.");
      expect(sync.sourceChunkCount).toBeGreaterThan(0);

      const db = getDb();
      const chunkRows = await db
        .select()
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceDocumentId, saved.sourceDocumentId));
      expect(chunkRows.length).toBeGreaterThan(0);
      expect(
        chunkRows.some(
          (chunk) =>
            chunk.sourceDocumentId === saved.sourceDocumentId &&
            chunk.sourceType === "work_summary",
        ),
      ).toBe(true);

      const sourceChunkEmbeddings = await db
        .select()
        .from(embeddings)
        .where(
          and(
            eq(embeddings.sourceEntityType, "source_document"),
            eq(embeddings.indexType, "source_chunk_index"),
          ),
        );
      expect(
        sourceChunkEmbeddings.some(
          (chunk) =>
            chunk.metadata.source_document_id === saved.sourceDocumentId &&
            chunk.metadata.source_type === "work_summary",
        ),
      ).toBe(true);

      const sourceMaterial = await retrieveSourceMaterialForEvidenceGaps(
        "activation dashboard evidence",
        { limit: 5 },
      );
      expect(
        sourceMaterial.some((item) => item.source_document_id === saved.sourceDocumentId),
      ).toBe(true);
      expect(sourceMaterial.every((item) => item.retrieval_policy === "evidence_enrichment")).toBe(true);
      expect(sourceMaterial.every((item) => item.convert_to_evidence_first)).toBe(true);
      expect(
        sourceMaterial.every(
          (item) =>
            item.required_next_step === "convert_or_enrich_evidence_before_resume_use" &&
            item.reason_for_selection.join(" ").includes("convert to evidence"),
        ),
      ).toBe(true);
    });
  });

  it("cleans stale source chunk embeddings when source chunks are rebuilt", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `source-chunk-rebuild-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected test user.");

    await runWithAuthContext(owner.user.id, async () => {
      const parsed = buildParsedSource(
        `Source chunk stale cleanup ${suffix}`,
        [
          "Built lifecycle analytics instrumentation for onboarding activation dashboards.",
          "Captured metric definitions, SQL validation rules, stakeholder review notes, rollout risks, and follow-up decisions for resume evidence extraction.",
          "Documented additional source-only context about product adoption, weekly reporting, partner dependencies, launch timeline, and ownership boundaries.",
          "Recorded detailed implementation notes about schema quality, event taxonomy naming, dashboard QA, and retention cohort validation.",
          "Stored retrospective source material for future enrichment, but none of this raw chunk text should bypass evidence conversion.",
          ...Array.from({ length: 18 }, (_, index) =>
            `Extended source paragraph ${index} covers activation cohort instrumentation, launch readiness, stakeholder alignment, validation workflow, metric governance, ownership boundaries, reporting cadence, and enrichment-only supporting material.`,
          ),
        ].join(" "),
      );
      const saved = await persistParsedSourceDocument({
        sourceType: "work_summary",
        parsed,
      });
      if (saved.status !== "saved") throw new Error("Expected saved source.");

      const db = getDb();
      const sync = await syncPersonalEmbeddings();
      if (sync.status !== "saved") throw new Error("Expected saved embeddings.");

      const initialChunks = await db
        .select()
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceDocumentId, saved.sourceDocumentId));
      expect(initialChunks.length).toBeGreaterThan(1);
      const initialChunkIds = initialChunks.map((chunk) => chunk.id);

      const initialEmbeddings = await db
        .select()
        .from(embeddings)
        .where(
          and(
            eq(embeddings.workspaceId, initialChunks[0]!.workspaceId),
            eq(embeddings.indexType, "source_chunk_index"),
            inArray(embeddings.sourceEntityId, initialChunkIds),
          ),
        );
      expect(initialEmbeddings.length).toBe(initialChunks.length);

      const shorterText = [
        `Source chunk stale cleanup ${suffix}`,
        "Built lifecycle analytics instrumentation and captured concise activation evidence context for later conversion.",
      ].join("\n");
      await db
        .update(sourceDocuments)
        .set({
          contentText: shorterText,
          contentHash: buildSourceContentHash(shorterText),
          lifecycleStatus: "parsed",
          updatedAt: new Date(),
        })
        .where(eq(sourceDocuments.id, saved.sourceDocumentId));

      await syncPersonalEmbeddings();

      const rebuiltChunks = await db
        .select()
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceDocumentId, saved.sourceDocumentId));
      expect(rebuiltChunks.length).toBe(1);

      const staleEmbeddings = await db
        .select()
        .from(embeddings)
        .where(
          and(
            eq(embeddings.workspaceId, rebuiltChunks[0]!.workspaceId),
            eq(embeddings.indexType, "source_chunk_index"),
            inArray(embeddings.sourceEntityId, initialChunkIds.slice(1)),
          ),
        );
      expect(staleEmbeddings).toHaveLength(0);
    });
  });

  it("rebuilds parsed source chunks on extraction and keeps resume retrieval limited to canonical evidence", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-boundary-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected test user.");

    await runWithAuthContext(owner.user.id, async () => {
      const uniqueToken = `activation-proof-${suffix}`;
      const parsed = buildParsedSource(
        `Resume boundary ${suffix}`,
        [
          `Captured raw launch notes for ${uniqueToken}.`,
          "Built onboarding activation dashboards with SQL and event taxonomy data.",
          "Documented unresolved follow-up metrics and role scope in source material only.",
        ].join(" "),
      );
      const saved = await persistParsedSourceDocument({
        sourceType: "work_summary",
        parsed,
      });
      if (saved.status !== "saved") throw new Error("Expected saved source.");

      const db = getDb();
      const parsedChunks = await db
        .select()
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceDocumentId, saved.sourceDocumentId));
      expect(parsedChunks.length).toBeGreaterThan(0);
      expect(parsedChunks.every((chunk) => chunk.lifecycleStatus === "parsed")).toBe(true);

      const gapResults = await retrieveSourceMaterialForEvidenceGaps(uniqueToken, { limit: 1 });
      expect(gapResults).toHaveLength(1);
      expect(gapResults[0]).toMatchObject({
        source_document_id: saved.sourceDocumentId,
        retrieval_policy: "evidence_enrichment",
        required_next_step: "convert_or_enrich_evidence_before_resume_use",
        convert_to_evidence_first: true,
        lifecycle_status: "parsed",
      });

      const resumeBeforeExtraction = await getResumeTailoringContext(
        buildResumeRetrievalContextFromQuery(uniqueToken),
      );
      expect(
        resumeBeforeExtraction.evidenceItems.every(
          (item) =>
            !("chunk_text" in item) &&
            !("convert_to_evidence_first" in item) &&
            item.public_safe_summary !==
              `Built resume-safe activation dashboard evidence for ${uniqueToken}.`,
        ),
      ).toBe(true);

      const persistence = await persistProfileEvidenceExtraction({
        sourceText: parsed.sourceText,
        sourceTitle: parsed.sourceTitle,
        sourceDocumentId: saved.sourceDocumentId,
        sourceType: "project-note",
        extraction: buildResumeSafeExtraction(uniqueToken),
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
        sourceDocumentId: saved.sourceDocumentId,
      });

      const rebuiltChunks = await db
        .select()
        .from(sourceChunks)
        .where(eq(sourceChunks.sourceDocumentId, saved.sourceDocumentId));
      expect(rebuiltChunks.length).toBeGreaterThan(0);
      expect(rebuiltChunks.every((chunk) => chunk.lifecycleStatus === "extracted")).toBe(true);
      expect(rebuiltChunks.every((chunk) => chunk.sourceType === "project-note")).toBe(true);

      const [evidence] = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.sourceDocumentId, saved.sourceDocumentId))
        .limit(1);
      if (!evidence) throw new Error("Expected extracted evidence.");
      const approved = await updateEvidenceItem({
        evidenceId: evidence.id,
        action: "approve_for_resume",
        allowedUsage: ["resume"],
      });
      expect(approved).toMatchObject({
        status: "saved",
        evidenceItem: {
          id: evidence.id,
          status: "approved",
          allowedUsage: ["resume"],
          needsUserConfirmation: false,
        },
      });

      const resumeAfterExtraction = await getResumeTailoringContext(
        buildResumeRetrievalContextFromQuery(uniqueToken),
      );
      const canonicalMatch = resumeAfterExtraction.evidenceItems.find(
        (item) => item.id === evidence.id,
      );
      expect(canonicalMatch).toMatchObject({
        id: evidence.id,
        retrieval_policy: "resume_generation",
        allowed_usage: ["resume"],
        public_safe_summary: `Built resume-safe activation dashboard evidence for ${uniqueToken}.`,
      });
      expect(
        resumeAfterExtraction.evidenceItems.every(
          (item) => !("chunk_text" in item) && !("convert_to_evidence_first" in item),
        ),
      ).toBe(true);

      const gapResultsAfterExtraction = await retrieveSourceMaterialForEvidenceGaps(uniqueToken, {
        limit: 1,
      });
      expect(gapResultsAfterExtraction[0]).toMatchObject({
        source_document_id: saved.sourceDocumentId,
        lifecycle_status: "extracted",
        convert_to_evidence_first: true,
      });
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

  it("redirects evidence from consolidated initiative fragments to the inserted merged initiative", async () => {
    const parsed = buildParsedSource(`Fragmented initiative ${Date.now()}`);
    const parsedSource = await persistParsedSourceDocument({
      sourceType: "project_note",
      parsed,
    });
    if (parsedSource.status !== "saved") {
      throw new Error("Expected saved parsed source.");
    }

    const extraction = buildFragmentedInitiativeExtraction();
    const persistence = await persistProfileEvidenceExtraction({
      sourceText: parsed.sourceText,
      sourceTitle: parsed.sourceTitle,
      sourceDocumentId: parsedSource.sourceDocumentId,
      sourceType: "project-note",
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

    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const insertedInitiatives = await db
      .select()
      .from(initiatives)
      .where(
        and(
          eq(initiatives.workspaceId, workspace.id),
          eq(initiatives.sourceDocumentId, parsedSource.sourceDocumentId),
        ),
      );
    expect(insertedInitiatives).toHaveLength(1);
    const [mergedInitiative] = insertedInitiatives;
    expect(mergedInitiative).toBeTruthy();
    expect(mergedInitiative?.technologies).toEqual(
      expect.arrayContaining(["AWS CDK", "distributed cache"]),
    );
    expect(mergedInitiative?.results).toContain("Optimized session latency.");

    const linkedEvidence = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.sourceDocumentId, parsedSource.sourceDocumentId));
    const fragmentEvidence = linkedEvidence.filter((item) =>
      [
        "Provisioned cloud infrastructure using AWS CDK.",
        "Optimized session latency with distributed caching.",
        "Built distributed cloud caching for a high-scale delivery service.",
      ].includes(item.text),
    );
    expect(fragmentEvidence).toHaveLength(3);
    expect(fragmentEvidence.every((item) => item.relatedInitiativeId === mergedInitiative?.id)).toBe(true);
  });

  it("creates a user-confirmed work experience before assigning an initiative", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const [selectedTarget] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        internalTitle: `Unassigned initiative ${Date.now()}`,
        externalSafeTitle: "Unassigned initiative",
        context: "Project note did not include employer or role context.",
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
    if (!selectedTarget) throw new Error("Expected selected initiative.");

    const result = await createWorkExperienceAndAssignInitiative({
      initiativeId: selectedTarget.id,
      employer: "Confirmed Employer",
      roleTitle: "Confirmed Role",
      startDate: "2025",
      summary: "User-confirmed role container for imported project material.",
    });
    expect(result).toMatchObject({ status: "saved" });

    const [updatedTarget] = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, selectedTarget.id))
      .limit(1);
    expect(updatedTarget?.workExperienceId).toBeTruthy();

    const [createdRole] = await db
      .select()
      .from(workExperiences)
      .where(eq(workExperiences.id, updatedTarget!.workExperienceId!))
      .limit(1);
    expect(createdRole).toMatchObject({
      employer: "Confirmed Employer",
      roleTitle: "Confirmed Role",
      status: "pending",
      workspaceId: workspace.id,
    });
  });
});

function buildParsedSource(title: string, body?: string): ResumeSourceParseResult {
  const sourceText = [
    title,
    body ??
      [
        "Built onboarding analytics dashboards with SQL and product event data.",
        "Led stakeholder readouts, clarified funnel health, and documented decisions.",
        "Created reusable project summaries, metrics, ownership context, and resume-safe wording.",
      ].join("\n"),
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

function buildResumeSafeExtraction(uniqueToken: string): ProfileEvidenceExtraction {
  return {
    ...buildExtraction(uniqueToken),
    evidence_items: [
      {
        text: `Built activation dashboard evidence for ${uniqueToken}.`,
        evidence_type: "extracted",
        status: "approved",
        source_quote: `Captured raw launch notes for ${uniqueToken}.`,
        metrics: [{ value: "activation dashboard", source_quote: "activation dashboards" }],
        sensitivity_level: "public_safe",
        allowed_usage: ["resume"],
        needs_user_confirmation: false,
        public_safe_summary: `Built resume-safe activation dashboard evidence for ${uniqueToken}.`,
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

function buildFragmentedInitiativeExtraction(): ProfileEvidenceExtraction {
  const roleRef = "Amazon · Software Engineer";
  return {
    ...buildExtraction("fragmented initiative"),
    work_experiences: [
      {
        employer: "Amazon",
        role_title: "Software Engineer",
        team: null,
        location: null,
        start_date: null,
        end_date: null,
        summary: "Built cloud infrastructure for delivery service performance.",
        status: "pending",
      },
    ],
    initiatives: [
      {
        internal_title: "AWS infrastructure provisioning with CDK",
        external_safe_title: "AWS infrastructure provisioning with CDK",
        work_experience_ref: roleRef,
        context: null,
        problem: null,
        role: null,
        actions: ["Provisioned cloud infrastructure using AWS CDK."],
        results: [],
        metrics: [],
        technologies: ["AWS CDK"],
        stakeholders: [],
        external_safe_summary: null,
        sensitivity_level: "private",
        needs_redaction_review: false,
        status: "pending",
      },
      {
        internal_title: "Session latency optimization with distributed caching",
        external_safe_title: "Session latency optimization with distributed caching",
        work_experience_ref: roleRef,
        context: null,
        problem: null,
        role: null,
        actions: [],
        results: ["Optimized session latency."],
        metrics: [],
        technologies: ["distributed cache"],
        stakeholders: [],
        external_safe_summary: null,
        sensitivity_level: "private",
        needs_redaction_review: false,
        status: "pending",
      },
      {
        internal_title: "Distributed cloud caching for high-scale delivery service",
        external_safe_title: "Distributed cloud caching for high-scale delivery service",
        work_experience_ref: roleRef,
        context: "High-scale delivery service had session latency constraints.",
        problem: "Session dependency latency affected delivery service performance.",
        role: null,
        actions: [],
        results: [],
        metrics: [],
        technologies: ["distributed cache"],
        stakeholders: [],
        external_safe_summary: null,
        sensitivity_level: "private",
        needs_redaction_review: false,
        status: "pending",
      },
    ],
    evidence_items: [
      {
        text: "Provisioned cloud infrastructure using AWS CDK.",
        evidence_type: "extracted",
        status: "pending",
        source_quote: "Provisioned cloud infrastructure using AWS CDK.",
        metrics: [],
        sensitivity_level: "private",
        allowed_usage: [],
        needs_user_confirmation: true,
        public_safe_summary: null,
        related_project_id: null,
        related_initiative_id: "AWS infrastructure provisioning with CDK",
      },
      {
        text: "Optimized session latency with distributed caching.",
        evidence_type: "extracted",
        status: "pending",
        source_quote: "Optimized session latency with distributed caching.",
        metrics: [],
        sensitivity_level: "private",
        allowed_usage: [],
        needs_user_confirmation: true,
        public_safe_summary: null,
        related_project_id: null,
        related_initiative_id: "Session latency optimization with distributed caching",
      },
      {
        text: "Built distributed cloud caching for a high-scale delivery service.",
        evidence_type: "extracted",
        status: "pending",
        source_quote: "Built distributed cloud caching for a high-scale delivery service.",
        metrics: [],
        sensitivity_level: "private",
        allowed_usage: [],
        needs_user_confirmation: true,
        public_safe_summary: null,
        related_project_id: null,
        related_initiative_id: "Distributed cloud caching for high-scale delivery service",
      },
    ],
  };
}
