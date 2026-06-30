export type SkillModelTier = "none" | "cheap" | "strong";

export type RuntimeSkillId =
  | "jd-analysis"
  | "profile-evidence-extraction-resume"
  | "profile-evidence-extraction-project-note"
  | "profile-positioning"
  | "resume-review-general"
  | "generated-resume-readiness-review"
  | "main-resume"
  | "tailored-resume"
  | "fact-guard-v0"
  | "external-safe-summary"
  | "interview-prep-v1";

export type SourceSkillId =
  | "behavioral-interview-coach"
  | "claim-support-judgment"
  | "company-research"
  | "evidence-extraction"
  | "hr-screening-review"
  | "interview-review"
  | "job-recommendation-ranking"
  | "jd-analysis"
  | "profile-extraction"
  | "profile-positioning"
  | "project-deidentification"
  | "recruiting-email-classification"
  | "resume-tailoring"
  | "star-story-extraction";

export type SkillRegistryEntry = {
  readonly skillId: RuntimeSkillId;
  readonly skillVersion: string;
  readonly promptVersion: string;
  readonly workflowType: string;
  readonly schemaName: string;
  readonly schemaVersion: string;
  readonly modelTier: SkillModelTier;
  readonly sourceSkillIds: readonly SourceSkillId[];
};

export type SkillPromptMetadata = Pick<
  SkillRegistryEntry,
  | "skillId"
  | "skillVersion"
  | "promptVersion"
  | "workflowType"
  | "schemaName"
  | "schemaVersion"
  | "modelTier"
  | "sourceSkillIds"
>;

export const skillRegistry = {
  jdAnalysis: {
    skillId: "jd-analysis",
    skillVersion: "0.1",
    promptVersion: "jd-analysis-v1",
    workflowType: "jd-analysis",
    schemaName: "JDAnalysis",
    schemaVersion: "0.1",
    modelTier: "cheap",
    sourceSkillIds: ["jd-analysis"],
  },
  profileEvidenceExtractionResume: {
    skillId: "profile-evidence-extraction-resume",
    skillVersion: "0.1",
    promptVersion: "profile-evidence-extraction-resume-v1",
    workflowType: "profile-evidence-extraction",
    schemaName: "ProfileEvidenceExtraction",
    schemaVersion: "0.1",
    modelTier: "cheap",
    sourceSkillIds: [
      "profile-extraction",
      "evidence-extraction",
      "project-deidentification",
      "star-story-extraction",
    ],
  },
  profileEvidenceExtractionProjectNote: {
    skillId: "profile-evidence-extraction-project-note",
    skillVersion: "0.1",
    promptVersion: "profile-evidence-extraction-project-note-v1",
    workflowType: "profile-evidence-extraction",
    schemaName: "ProfileEvidenceExtraction",
    schemaVersion: "0.1",
    modelTier: "cheap",
    sourceSkillIds: [
      "evidence-extraction",
      "project-deidentification",
      "star-story-extraction",
    ],
  },
  profilePositioning: {
    skillId: "profile-positioning",
    skillVersion: "0.1",
    promptVersion: "profile-positioning-v1",
    workflowType: "profile-positioning",
    schemaName: "ProfilePositioningReport",
    schemaVersion: "0.1",
    modelTier: "strong",
    sourceSkillIds: ["profile-positioning"],
  },
  resumeReviewGeneral: {
    skillId: "resume-review-general",
    skillVersion: "0.1",
    promptVersion: "resume-review-general-v1",
    workflowType: "resume-review",
    schemaName: "ResumeReview",
    schemaVersion: "0.1",
    modelTier: "strong",
    sourceSkillIds: ["hr-screening-review"],
  },
  generatedResumeReadinessReview: {
    skillId: "generated-resume-readiness-review",
    skillVersion: "0.1",
    promptVersion: "generated-resume-readiness-v1",
    workflowType: "generated-resume-readiness-review",
    schemaName: "GeneratedResumeReadinessReview",
    schemaVersion: "0.1",
    modelTier: "none",
    sourceSkillIds: ["hr-screening-review", "claim-support-judgment"],
  },
  mainResume: {
    skillId: "main-resume",
    skillVersion: "0.1",
    promptVersion: "main-resume-v1",
    workflowType: "main-resume",
    schemaName: "MainResumeDraft",
    schemaVersion: "0.1",
    modelTier: "strong",
    sourceSkillIds: ["resume-tailoring", "claim-support-judgment"],
  },
  tailoredResume: {
    skillId: "tailored-resume",
    skillVersion: "0.1",
    promptVersion: "tailored-resume-v1",
    workflowType: "tailored-resume",
    schemaName: "TailoredResumeDraft",
    schemaVersion: "0.1",
    modelTier: "strong",
    sourceSkillIds: ["resume-tailoring"],
  },
  factGuardV0: {
    skillId: "fact-guard-v0",
    skillVersion: "0.1",
    promptVersion: "fact-guard-v0",
    workflowType: "fact-guard",
    schemaName: "FactGuardClaimReport",
    schemaVersion: "0.1",
    modelTier: "none",
    sourceSkillIds: ["claim-support-judgment"],
  },
  externalSafeSummary: {
    skillId: "external-safe-summary",
    skillVersion: "0.1",
    promptVersion: "external-safe-summary-v1",
    workflowType: "deidentification",
    schemaName: "ExternalSafeSummarySuggestion",
    schemaVersion: "0.1",
    modelTier: "cheap",
    sourceSkillIds: ["project-deidentification"],
  },
  interviewPrepV1: {
    skillId: "interview-prep-v1",
    skillVersion: "0.1",
    promptVersion: "interview-prep-v1",
    workflowType: "interview-prep",
    schemaName: "InterviewPrepPack",
    schemaVersion: "0.1",
    modelTier: "none",
    sourceSkillIds: ["behavioral-interview-coach"],
  },
} as const satisfies Record<string, SkillRegistryEntry>;

const entries = Object.values(skillRegistry);

export function getSkillRegistryEntry(skillId: RuntimeSkillId): SkillRegistryEntry {
  const entry = entries.find((candidate) => candidate.skillId === skillId);
  if (!entry) {
    throw new Error(`Unknown JobDesk skill registry entry: ${skillId}`);
  }
  return entry;
}

export function getSkillPromptMetadata(
  skillId: RuntimeSkillId,
): SkillPromptMetadata {
  return getSkillRegistryEntry(skillId);
}

export function getProfileEvidenceSkillForSource(
  sourceKind: "resume" | "project_note" = "resume",
) {
  return sourceKind === "project_note"
    ? skillRegistry.profileEvidenceExtractionProjectNote
    : skillRegistry.profileEvidenceExtractionResume;
}
