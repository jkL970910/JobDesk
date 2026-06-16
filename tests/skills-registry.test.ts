import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { skillRegistry } from "../src/ai/skills-registry";

describe("skills registry", () => {
  it("has unique runtime skill and prompt identifiers", () => {
    const entries = Object.values(skillRegistry);
    const skillIds = new Set(entries.map((entry) => entry.skillId));
    const promptVersions = new Set(entries.map((entry) => entry.promptVersion));

    expect(skillIds.size).toBe(entries.length);
    expect(promptVersions.size).toBe(entries.length);
  });

  it("binds every live LLM workflow to a registry entry", () => {
    expect(skillRegistry.jdAnalysis).toMatchObject({
      skillId: "jd-analysis",
      workflowType: "jd-analysis",
      schemaName: "JDAnalysis",
      modelTier: "cheap",
    });
    expect(skillRegistry.profileEvidenceExtractionResume).toMatchObject({
      skillId: "profile-evidence-extraction-resume",
      workflowType: "profile-evidence-extraction",
      schemaName: "ProfileEvidenceExtraction",
    });
    expect(skillRegistry.profileEvidenceExtractionProjectNote).toMatchObject({
      skillId: "profile-evidence-extraction-project-note",
      workflowType: "profile-evidence-extraction",
      schemaName: "ProfileEvidenceExtraction",
    });
    expect(skillRegistry.resumeReviewGeneral).toMatchObject({
      skillId: "resume-review-general",
      workflowType: "resume-review",
      schemaName: "ResumeReview",
      modelTier: "strong",
    });
    expect(skillRegistry.mainResume).toMatchObject({
      skillId: "main-resume",
      workflowType: "main-resume",
      schemaName: "MainResumeDraft",
      modelTier: "strong",
    });
    expect(skillRegistry.tailoredResume).toMatchObject({
      skillId: "tailored-resume",
      workflowType: "tailored-resume",
      schemaName: "TailoredResumeDraft",
      modelTier: "strong",
    });
  });

  it("references checked-in source skill files", () => {
    for (const entry of Object.values(skillRegistry)) {
      for (const sourceSkillId of entry.sourceSkillIds) {
        expect(existsSync(`skills/${sourceSkillId}/SKILL.md`)).toBe(true);
      }
    }
  });
});
