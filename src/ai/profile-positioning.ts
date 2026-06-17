import { ProfilePositioningReport } from "../schemas/profile-positioning";
import type { TailoredResumeEvidenceContext } from "./tailored-resume";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";

export async function generateProfilePositioningWithAi(params: {
  profile: Record<string, unknown>;
  evidenceItems: TailoredResumeEvidenceContext[];
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });
  return adapter.callStructuredJson({
    task: "profile-positioning",
    skill: skillRegistry.profilePositioning,
    schema: ProfilePositioningReport,
    instructions: buildProfilePositioningInstructions(),
    input: JSON.stringify({
      profile: params.profile,
      approved_resume_evidence: params.evidenceItems.map(toPositioningEvidence),
    }),
    maxOutputTokens: 3600,
    timeoutMs: 180_000,
  });
}

function toPositioningEvidence(item: TailoredResumeEvidenceContext) {
  const publicSafeSummary = item.public_safe_summary?.trim();
  return {
    id: item.id,
    text: publicSafeSummary || item.text,
    source_quote: item.source_quote,
    public_safe_summary: publicSafeSummary || null,
    sensitivity_level: item.sensitivity_level,
    metrics: item.metrics,
    retrieval_score: item.retrieval_score ?? null,
    reason_for_selection: item.reason_for_selection ?? [],
  };
}

export function buildProfilePositioningInstructions() {
  return composeSkillPrompt(skillRegistry.profilePositioning, [
    "You are JobDesk's Profile Positioning Engine.",
    "Return only a valid JSON object. Do not return markdown fences.",
    "Use exactly these top-level keys: summary, generated_at, directions, global_strengths, global_gaps.",
    "Recommend 3 to 5 target role directions based only on the supplied profile and approved_resume_evidence.",
    "Do not use outside job-market data, popularity trends, or assumptions about the user.",
    "Do not state that the user should become a role. Frame each direction as an evidence-backed fit hypothesis.",
    "Every direction must cite supporting_evidence entries whose evidence_id values exist in approved_resume_evidence.",
    "If evidence is weak, lower fit_score/confidence and add specific missing_evidence_questions.",
    "Fit scores must reflect evidence strength and role-scope support, not market popularity.",
    "Use role_family values only from: product, data, ai_ml, technical, growth, strategy_ops, other.",
    "Use confidence values only from: low, medium, high.",
    "resume_emphasis should guide a future main resume variant; do not generate the resume itself.",
    "Set generated_at to the current ISO timestamp if available from context; otherwise use a valid ISO timestamp.",
  ]);
}
