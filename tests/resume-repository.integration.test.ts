import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import { persistJdAnalysis } from "../src/server/job-repository";
import {
  getRecentEvidenceLibrary,
  getResumeTailoringContext,
  persistProfileEvidenceExtraction,
  updateEvidenceItem,
} from "../src/server/profile-evidence-repository";
import {
  getMainResumeById,
  getRecentMainResumes,
  getRecentTailoredResumes,
  persistMainResume,
  persistTailoredResumeFailure,
  persistTailoredResume,
  runFactGuardForMainResume,
  runFactGuardForResume,
} from "../src/server/resume-repository";
import type { JDAnalysis } from "../src/schemas/jd-analysis";
import type { TailoredResumeDraft } from "../src/schemas/tailored-resume";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";
import { skillRegistry } from "../src/ai/skills-registry";
import { expectWorkflowRunMetadata } from "./helpers/workflow-run-assertions";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("resume repository database integration", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("persists tailored resume versions and generated claim ledgers", async () => {
    const jobResult = await persistJdAnalysis({
      analysis: buildAnalysis(),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.jdAnalysis,
    });
    if (jobResult.status !== "saved" || !jobResult.jobId) {
      throw new Error("Expected saved job.");
    }
    await expectWorkflowRunMetadata(jobResult.workflowRunId, {
      skillId: "jd-analysis",
      promptVersion: "jd-analysis-v1",
      schemaName: "JDAnalysis",
      sourceSkillIds: ["jd-analysis"],
    });

    const evidenceId = await createApprovedResumeEvidence();
    const draft = buildResumeDraft(evidenceId);
    const result = await persistTailoredResume({
      jobId: jobResult.jobId,
      draft,
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 99 },
      retryCount: 1,
      skill: skillRegistry.tailoredResume,
    });

    expect(result).toMatchObject({
      status: "saved",
      claimCount: 1,
    });
    if (result.status !== "saved") {
      throw new Error("Expected saved tailored resume.");
    }
    await expectWorkflowRunMetadata(result.workflowRunId, {
      skillId: "tailored-resume",
      promptVersion: "tailored-resume-v1",
      schemaName: "TailoredResumeDraft",
      sourceSkillIds: ["resume-tailoring"],
    });

    const recent = await getRecentTailoredResumes(10);
    const saved = recent.find((resume) => resume.id === result.resumeVersionId);
    expect(saved).toMatchObject({
      jobId: jobResult.jobId,
      title: "Tailored integration resume",
      status: "unvalidated",
      missing_evidence_questions: ["What measurable dashboard outcome can be added?"],
    });
    expect(saved?.claims).toHaveLength(1);
    expect(saved?.claims[0]).toMatchObject({
      claim_text: "Built SQL dashboards for onboarding funnel analysis.",
      evidence_ids: [evidenceId],
      support_status: "unvalidated",
      claim_status: "unvalidated",
      risk_level: "low",
    });

    const guarded = await runFactGuardForResume(result.resumeVersionId);
    expect(guarded).toMatchObject({
      status: "validated",
      claimCount: 1,
      supportedCount: 1,
      resumeStatus: "validated",
    });
    expect(guarded.status).toBe("validated");
    if (guarded.status !== "validated") {
      throw new Error("Expected validated Fact Guard result.");
    }
    if (!guarded.workflowRunId) throw new Error("Expected Fact Guard workflow run.");
    await expectWorkflowRunMetadata(guarded.workflowRunId, {
      skillId: "fact-guard-v0",
      promptVersion: "fact-guard-v0",
      schemaName: "FactGuardClaimReport",
      sourceSkillIds: ["claim-support-judgment"],
    });
    expect(guarded.claims).toHaveLength(1);
    expect(guarded.claims[0]).toMatchObject({
      claim_text: "Built SQL dashboards for onboarding funnel analysis.",
      support_status: "supported",
      claim_status: "supported",
      stale_reason: null,
    });
    expect(guarded.claims[0]?.last_validated_at).toEqual(expect.any(String));

    const recentAfterGuard = await getRecentTailoredResumes(10);
    const guardedResume = recentAfterGuard.find(
      (resume) => resume.id === result.resumeVersionId,
    );
    expect(guardedResume).toMatchObject({
      status: "validated",
    });
    expect(guardedResume?.claims[0]).toMatchObject({
      support_status: "supported",
      claim_status: "supported",
    });

    const uncoveredResult = await persistTailoredResume({
      jobId: jobResult.jobId,
      draft: {
        ...buildResumeDraft(evidenceId),
        resume_markdown:
          "## Experience\n- Built SQL dashboards for onboarding funnel analysis.\n- Migrated Kubernetes clusters.",
      },
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.tailoredResume,
    });
    if (uncoveredResult.status !== "saved") {
      throw new Error("Expected saved uncovered tailored resume.");
    }
    await expectWorkflowRunMetadata(uncoveredResult.workflowRunId, {
      skillId: "tailored-resume",
      promptVersion: "tailored-resume-v1",
      schemaName: "TailoredResumeDraft",
      sourceSkillIds: ["resume-tailoring"],
    });
    const uncoveredGuard = await runFactGuardForResume(
      uncoveredResult.resumeVersionId,
    );
    expect(uncoveredGuard).toMatchObject({
      status: "validated",
      supportedCount: 0,
      resumeStatus: "unvalidated",
      coveragePassed: false,
    });
    expect(uncoveredGuard.status).toBe("validated");
    if (uncoveredGuard.status !== "validated") {
      throw new Error("Expected validated Fact Guard result.");
    }
    if (!uncoveredGuard.workflowRunId) {
      throw new Error("Expected uncovered Fact Guard workflow run.");
    }
    await expectWorkflowRunMetadata(uncoveredGuard.workflowRunId, {
      skillId: "fact-guard-v0",
      promptVersion: "fact-guard-v0",
      schemaName: "FactGuardClaimReport",
      sourceSkillIds: ["claim-support-judgment"],
    });
    expect(uncoveredGuard.claims[0]).toMatchObject({
      support_status: "partially_supported",
      claim_status: "partially_supported",
      stale_reason: expect.stringContaining("resume bullet is not mapped"),
    });
    const recentAfterCoverageFailure = await getRecentTailoredResumes(10);
    const uncoveredResume = recentAfterCoverageFailure.find(
      (resume) => resume.id === uncoveredResult.resumeVersionId,
    );
    expect(uncoveredResume?.claims[0]).toMatchObject({
      support_status: "partially_supported",
      claim_status: "partially_supported",
    });
    expect(uncoveredResume?.claims[0]?.stale_reason).toContain(
      "resume bullet is not mapped",
    );

    const mainResumeResult = await persistMainResume({
      draft: {
        ...buildResumeDraft(evidenceId),
        title: "General integration resume",
      },
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 77 },
      retryCount: 0,
      skill: skillRegistry.mainResume,
    });
    expect(mainResumeResult).toMatchObject({
      status: "saved",
      claimCount: 1,
    });
    if (mainResumeResult.status !== "saved") {
      throw new Error("Expected saved main resume.");
    }
    await expectWorkflowRunMetadata(mainResumeResult.workflowRunId, {
      skillId: "main-resume",
      promptVersion: "main-resume-v1",
      schemaName: "MainResumeDraft",
      workflowType: "main-resume",
      sourceSkillIds: ["resume-tailoring", "claim-support-judgment"],
    });
    const mainFailure = await persistTailoredResumeFailure({
      provider: "integration-test",
      model: "test-model",
      errorKind: "provider_error",
      errorMessage: "main resume provider failure",
      retryCount: 0,
      skill: skillRegistry.mainResume,
    });
    if (mainFailure.status !== "saved") {
      throw new Error("Expected saved main resume failure workflow run.");
    }
    await expectWorkflowRunMetadata(mainFailure.workflowRunId, {
      skillId: "main-resume",
      promptVersion: "main-resume-v1",
      schemaName: "MainResumeDraft",
      workflowType: "main-resume",
      sourceSkillIds: ["resume-tailoring", "claim-support-judgment"],
    });
    const recentMainResumes = await getRecentMainResumes(10);
    const mainResume = recentMainResumes.find(
      (resume) => resume.id === mainResumeResult.mainResumeVersionId,
    );
    expect(mainResume).toMatchObject({
      title: "General integration resume",
      status: "unvalidated",
    });
    expect(mainResume?.claims[0]).toMatchObject({
      claim_text: "Built SQL dashboards for onboarding funnel analysis.",
      evidence_ids: [evidenceId],
    });
    const exportedMainResume = await getMainResumeById(mainResumeResult.mainResumeVersionId);
    expect(exportedMainResume).toMatchObject({
      id: mainResumeResult.mainResumeVersionId,
      title: "General integration resume",
    });
    const mainGuard = await runFactGuardForMainResume(
      mainResumeResult.mainResumeVersionId,
    );
    expect(mainGuard).toMatchObject({
      status: "validated",
      supportedCount: 1,
      resumeStatus: "validated",
    });
  });

  it("does not retrieve another workspace's approved resume evidence", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `retrieval-owner-${suffix}@example.com`,
      password: "Password123!",
    });
    const other = await registerUser({
      email: `retrieval-other-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created" || other.status !== "created") {
      throw new Error("Expected test users to be created.");
    }

    const ownerEvidenceId = await runWithAuthContext(owner.user.id, () =>
      createApprovedResumeEvidence(),
    );
    await expect(
      runWithAuthContext(owner.user.id, () => getResumeTailoringContext()),
    ).resolves.toMatchObject({
      evidenceItems: expect.arrayContaining([
        expect.objectContaining({ id: ownerEvidenceId }),
      ]),
    });

    const otherContext = await runWithAuthContext(other.user.id, () =>
      getResumeTailoringContext({
        keywords: ["sql", "dashboards"],
        requirements: [{ text: "SQL dashboards", keywords: ["sql"] }],
      }),
    );
    expect(otherContext.evidenceItems.some((item) => item.id === ownerEvidenceId)).toBe(false);
  });
});

function buildAnalysis(): JDAnalysis {
  return {
    job_id: `resume-integration-${Date.now()}`,
    original_jd_text: "Product Analyst\nRequires SQL dashboards.",
    job_facts: {
      company: "Resume Integration Co",
      role_title: "Product Analyst",
      level: null,
      location: "Remote",
      responsibilities: ["Build dashboards."],
      preferred_qualifications: [],
    },
    role_archetype: "technical_ai_pm",
    job_legitimacy: {
      tier: "proceed_with_caution",
      signals: [],
      context_notes: [],
    },
    requirements: [
      {
        text: "SQL dashboards",
        source_quote: "Requires SQL dashboards.",
        requirement_type: "hard",
        importance: 0.9,
        keywords: ["sql", "dashboards"],
        verified: false,
      },
    ],
    role_signals: ["analytics"],
    keywords: ["sql"],
    interview_implications: ["Discuss dashboard evidence."],
  };
}

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
  const libraryEvidence = await getLatestSqlEvidenceFromRecentLibrary();
  await updateEvidenceItem({
    evidenceId: libraryEvidence.id,
    action: "approve_for_resume",
    allowedUsage: ["resume"],
  });
  const context = await getResumeTailoringContext();
  const eligible = context.evidenceItems.find((item) =>
    item.text.includes("SQL dashboards"),
  );
  if (!eligible) throw new Error("Expected eligible resume evidence.");
  return eligible.id;
}

async function getLatestSqlEvidenceFromRecentLibrary() {
  const library = await getRecentEvidenceLibrary(20);
  const evidence = library.evidenceItems.find((item) =>
    item.text.includes("SQL dashboards"),
  );
  if (!evidence) throw new Error("Expected SQL evidence.");
  return evidence;
}

function buildResumeDraft(evidenceId: string): TailoredResumeDraft {
  return {
    title: "Tailored integration resume",
    resume_json: {
      sections: [
        {
          title: "Experience",
          bullets: ["Built SQL dashboards for onboarding funnel analysis."],
        },
      ],
    },
    resume_markdown:
      "## Experience\n- Built SQL dashboards for onboarding funnel analysis.",
    claims: [
      {
        claim_text: "Built SQL dashboards for onboarding funnel analysis.",
        section: "Experience",
        evidence_ids: [evidenceId],
        source_quotes: ["Built SQL dashboards for onboarding funnel analysis."],
        risk_level: "low",
      },
    ],
    missing_evidence_questions: ["What measurable dashboard outcome can be added?"],
  };
}

const sampleSourceText = [
  "Jane Doe",
  "Senior Product Analyst at Acme Finance, 2019 - Present",
  "Built SQL dashboards for onboarding funnel analysis.",
].join("\n");

function buildExtraction(): ProfileEvidenceExtraction {
  return {
    profile: {
      name: {
        value: "Jane Doe",
        source_quote: "Jane Doe",
        confidence: 0.95,
      },
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
        text: "Built SQL dashboards for onboarding funnel analysis.",
        source_quote: "Built SQL dashboards for onboarding funnel analysis.",
        evidence_type: "extracted",
        metrics: [],
        sensitivity_level: "private",
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
