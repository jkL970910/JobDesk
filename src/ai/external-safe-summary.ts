import { ExternalSafeSummarySuggestion } from "../schemas/external-safe-summary";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";

export async function suggestExternalSafeSummaryWithAi(params: {
  evidenceText: string;
  sourceQuote?: string | null;
  sensitivityLevel?: string | null;
  blockedTerms?: string[];
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });

  return adapter.callStructuredJson({
    task: "external-safe-summary",
    skill: skillRegistry.externalSafeSummary,
    schema: ExternalSafeSummarySuggestion,
    instructions: buildExternalSafeSummaryInstructions(),
    input: JSON.stringify({
      evidence_text: params.evidenceText,
      source_quote: params.sourceQuote ?? null,
      sensitivity_level: params.sensitivityLevel ?? null,
      deterministic_blocked_terms: params.blockedTerms ?? [],
    }),
    maxOutputTokens: 1200,
    timeoutMs: 90_000,
  });
}

export function buildExternalSafeSummaryInstructions() {
  return composeSkillPrompt(skillRegistry.externalSafeSummary, [
    "You are JobDesk's external-safe wording assistant.",
    "Rewrite one evidence item into public-safe resume/interview wording for human review.",
    "Return only one valid JSON object. Do not return markdown.",
    "Use exactly these top-level keys: safe_summary, removed_or_generalized_terms, confidence, needs_user_review.",
    "safe_summary must preserve only facts supported by evidence_text or source_quote.",
    "Do not invent employers, titles, dates, technologies, metrics, scope, or outcomes.",
    "Remove or generalize client names, customer names, internal project names, confidential wording, unreleased product names, and deterministic_blocked_terms.",
    "If a metric appears sensitive or client-specific, generalize it qualitatively instead of inventing a replacement number.",
    "removed_or_generalized_terms must list each meaningful changed span with replacement and reason.",
    "needs_user_review must always be true.",
    "confidence must be low, medium, or high based on how safely the wording preserves the original achievement.",
  ]);
}
