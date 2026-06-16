import type { JobDeskAiSkillBinding } from "../ai/types";

export function workflowSkillFields(skill: JobDeskAiSkillBinding) {
  return {
    skillId: skill.skillId,
    skillVersion: skill.skillVersion,
    promptVersion: skill.promptVersion,
    schemaName: skill.schemaName,
    schemaVersion: skill.schemaVersion,
    modelTier: skill.modelTier,
    skillMetadata: {
      workflowType: skill.workflowType,
      sourceSkillIds: [...skill.sourceSkillIds],
    },
  };
}
