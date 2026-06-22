import { EnrichmentProposalRevision } from "../schemas/enrichment-proposal-revision";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";

export async function reviseEnrichmentProposalWithAi(params: {
  taskPrompt: string;
  targetLabel: string;
  originalAnswer: string | null;
  currentDraft: string;
  revisionInstruction: string;
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });

  return adapter.callStructuredJson({
    task: "enrichment-proposal-revision",
    skill: skillRegistry.profileEvidenceExtractionProjectNote,
    schema: EnrichmentProposalRevision,
    instructions: buildEnrichmentProposalRevisionInstructions(),
    input: JSON.stringify({
      task_prompt: params.taskPrompt,
      target: params.targetLabel,
      original_answer: params.originalAnswer,
      current_draft: params.currentDraft,
      revision_instruction: params.revisionInstruction,
    }),
    maxOutputTokens: 900,
    timeoutMs: 90_000,
  });
}

export function buildEnrichmentProposalRevisionInstructions() {
  return composeSkillPrompt(skillRegistry.profileEvidenceExtractionProjectNote, [
    "You revise one JobDesk draft evidence item based only on the provided task, original answer, current draft, and revision instruction.",
    "Return only a valid JSON object. Do not return markdown fences.",
    "Use exactly these keys: text, source_quote.",
    "text should be a concise, evidence-library-ready factual statement.",
    "source_quote should be copied from the original answer or current draft; do not invent provenance.",
    "Do not add metrics, technologies, employers, scope, ownership, outcomes, dates, or public-safe wording unless they are explicitly present in the original answer or current draft.",
    "Follow the revision_instruction for tone, focus, or wording, but never make the claim broader than the available facts.",
  ]);
}
