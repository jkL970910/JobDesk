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
  getRecentTailoredResumes,
  persistTailoredResume,
  runFactGuardForResume,
} from "../src/server/resume-repository";
import type { JDAnalysis } from "../src/schemas/jd-analysis";
import type { TailoredResumeDraft } from "../src/schemas/tailored-resume";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

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
    });
    if (jobResult.status !== "saved" || !jobResult.jobId) {
      throw new Error("Expected saved job.");
    }

    const evidenceId = await createApprovedResumeEvidence();
    const draft = buildResumeDraft(evidenceId);
    const result = await persistTailoredResume({
      jobId: jobResult.jobId,
      draft,
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 99 },
      retryCount: 1,
    });

    expect(result).toMatchObject({
      status: "saved",
      claimCount: 1,
    });
    if (result.status !== "saved") {
      throw new Error("Expected saved tailored resume.");
    }

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
    });
    if (uncoveredResult.status !== "saved") {
      throw new Error("Expected saved uncovered tailored resume.");
    }
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
