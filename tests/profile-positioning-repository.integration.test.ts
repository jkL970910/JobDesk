import { beforeAll, describe, expect, it } from "vitest";

import { skillRegistry } from "../src/ai/skills-registry";
import { loadDotEnv } from "../src/ai/env";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";
import type { TailoredResumeDraft } from "../src/schemas/tailored-resume";
import {
  getRecentEvidenceLibrary,
  getResumeTailoringContext,
  persistProfileEvidenceExtraction,
  updateEvidenceItem,
} from "../src/server/profile-evidence-repository";
import {
  getProfilePositioningContext,
  getProfilePositioningReportById,
  getRecentProfilePositioningReports,
  persistProfilePositioningFailure,
  persistProfilePositioningReport,
} from "../src/server/profile-positioning-repository";
import { getRecentMainResumes, persistMainResume } from "../src/server/resume-repository";
import { expectWorkflowRunMetadata } from "./helpers/workflow-run-assertions";
import { buildDirection } from "./support/profile-positioning-fixtures";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("profile positioning repository integration", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("persists positioning reports and links selected directions to main resume variants", async () => {
    const evidenceId = await createApprovedResumeEvidence();
    const context = await getProfilePositioningContext();
    expect(context.profile).toBeTruthy();
    expect(context.evidenceItems.some((item) => item.id === evidenceId)).toBe(true);

    const direction = buildDirection(evidenceId);
    const report = {
      summary: "Data/product positioning is the strongest current direction.",
      generated_at: new Date().toISOString(),
      directions: [direction],
      global_strengths: ["Analytics execution"],
      global_gaps: ["Product strategy scope"],
    };

    const persisted = await persistProfilePositioningReport({
      profileId: context.profile?.id ?? null,
      report,
      evidenceSnapshotHash: context.evidenceSnapshotHash,
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 44 },
      retryCount: 0,
      skill: skillRegistry.profilePositioning,
    });
    expect(persisted).toMatchObject({
      status: "saved",
      directionCount: 1,
    });
    if (persisted.status !== "saved") {
      throw new Error("Expected saved positioning report.");
    }
    await expectWorkflowRunMetadata(persisted.workflowRunId, {
      skillId: "profile-positioning",
      promptVersion: "profile-positioning-v1",
      schemaName: "ProfilePositioningReport",
      workflowType: "profile-positioning",
      sourceSkillIds: ["profile-positioning"],
    });

    const recentReports = await getRecentProfilePositioningReports(5);
    const savedReport = recentReports.find(
      (candidate) => candidate.id === persisted.profilePositioningReportId,
    );
    expect(savedReport?.report.directions[0]).toMatchObject({
      id: "data-product-manager",
      target_role: "Data Product Manager",
    });

    const loadedReport = await getProfilePositioningReportById(
      persisted.profilePositioningReportId,
    );
    expect(loadedReport?.evidenceSnapshotHash).toBe(context.evidenceSnapshotHash);

    const mainResume = await persistMainResume({
      draft: buildMainResumeDraft(evidenceId),
      positioning: {
        reportId: persisted.profilePositioningReportId,
        direction,
      },
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 55 },
      retryCount: 0,
      skill: skillRegistry.mainResume,
    });
    if (mainResume.status !== "saved") {
      throw new Error("Expected saved positioned main resume.");
    }
    const recentMainResumes = await getRecentMainResumes(5);
    const savedMainResume = recentMainResumes.find(
      (candidate) => candidate.id === mainResume.mainResumeVersionId,
    );
    expect(savedMainResume).toMatchObject({
      positioning_report_id: persisted.profilePositioningReportId,
      positioning_direction_id: "data-product-manager",
      positioning_title: "Data Product Manager",
    });

    const failure = await persistProfilePositioningFailure({
      provider: "integration-test",
      model: "test-model",
      errorKind: "provider_error",
      errorMessage: "positioning provider failure",
      retryCount: 1,
      skill: skillRegistry.profilePositioning,
    });
    if (failure.status !== "saved") {
      throw new Error("Expected saved positioning failure workflow run.");
    }
    await expectWorkflowRunMetadata(failure.workflowRunId, {
      skillId: "profile-positioning",
      promptVersion: "profile-positioning-v1",
      schemaName: "ProfilePositioningReport",
      workflowType: "profile-positioning",
      sourceSkillIds: ["profile-positioning"],
    });
  });
});

async function createApprovedResumeEvidence() {
  await persistProfileEvidenceExtraction({
    sourceText: sampleSourceText,
    extraction: buildExtraction(),
    provider: "integration-test",
    model: "test-model",
    usage: {},
    retryCount: 0,
    skill: skillRegistry.profileEvidenceExtractionResume,
  });
  const library = await getRecentEvidenceLibrary(20);
  const evidence = library.evidenceItems.find((item) =>
    item.text.includes("activation funnel dashboard"),
  );
  if (!evidence) throw new Error("Expected positioning evidence.");
  await updateEvidenceItem({
    evidenceId: evidence.id,
    action: "approve_for_resume",
    allowedUsage: ["resume"],
  });
  const context = await getResumeTailoringContext();
  const eligible = context.evidenceItems.find((item) =>
    item.text.includes("activation funnel dashboard"),
  );
  if (!eligible) throw new Error("Expected eligible positioning evidence.");
  return eligible.id;
}

function buildMainResumeDraft(evidenceId: string): TailoredResumeDraft {
  return {
    title: "Data Product Manager resume",
    resume_json: {
      sections: [{ title: "Experience", bullets: ["Built activation funnel dashboard."] }],
    },
    resume_markdown: "## Experience\n- Built activation funnel dashboard.",
    claims: [
      {
        claim_text: "Built activation funnel dashboard.",
        section: "Experience",
        evidence_ids: [evidenceId],
        source_quotes: ["Built activation funnel dashboard."],
        risk_level: "low",
      },
    ],
    missing_evidence_questions: [],
  };
}

const sampleSourceText = [
  "Jane Doe",
  "Senior Product Analyst at Acme Finance, 2019 - Present",
  "Built activation funnel dashboard.",
].join("\n");

function buildExtraction(): ProfileEvidenceExtraction {
  return {
    profile: {
      name: { value: "Jane Doe", source_quote: "Jane Doe", confidence: 0.95 },
      email: null,
      phone: null,
      location: null,
      links: [],
      education: [],
      experience: [],
      skills: [],
      certifications: [],
      missing_fields: [],
      low_confidence_fields: [],
      invented_field_flags: [],
    },
    work_experiences: [],
    initiatives: [],
    portfolio_projects: [],
    evidence_items: [
      {
        text: "Built activation funnel dashboard.",
        source_quote: "Built activation funnel dashboard.",
        evidence_type: "extracted",
        metrics: [],
        sensitivity_level: "public_safe",
        allowed_usage: ["resume"],
        public_safe_summary: null,
        status: "pending",
        related_project_id: null,
        needs_user_confirmation: false,
      },
    ],
    project_cards: [],
    extraction_notes: [],
  };
}
