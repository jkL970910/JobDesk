import { ProfilePositioningReport } from "../schemas/profile-positioning";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";

export type ProfilePositioningEvidenceContext = {
  id: string;
  text: string;
  source_quote: string;
  evidence_type?: string | null;
  status?: string | null;
  allowed_usage?: string[] | null;
  needs_user_confirmation?: boolean | null;
  metrics: Array<Record<string, unknown>>;
  sensitivity_level: string;
  public_safe_summary: string | null;
};

export async function generateProfilePositioningWithAi(params: {
  profile: Record<string, unknown>;
  evidenceItems: ProfilePositioningEvidenceContext[];
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
      profile_evidence_signals: params.evidenceItems.map(toPositioningEvidence),
    }),
    maxOutputTokens: 3600,
    timeoutMs: 180_000,
  });
}

function toPositioningEvidence(item: ProfilePositioningEvidenceContext) {
  const publicSafeSummary = item.public_safe_summary?.trim();
  return {
    id: item.id,
    text: publicSafeSummary || item.text,
    private_source_quote: item.source_quote,
    evidence_type: item.evidence_type ?? null,
    status: item.status ?? null,
    allowed_usage: item.allowed_usage ?? [],
    needs_user_confirmation: Boolean(item.needs_user_confirmation),
    public_safe_summary: publicSafeSummary || null,
    sensitivity_level: item.sensitivity_level,
    metrics: item.metrics,
  };
}

export function buildProfilePositioningInstructions() {
  return composeSkillPrompt(skillRegistry.profilePositioning, [
    "You are JobDesk's Profile Positioning Engine.",
    "Return only a valid JSON object. Do not return markdown fences.",
    "Use exactly these top-level keys: summary, generated_at, directions, global_strengths, global_gaps.",
    "Recommend 3 to 5 target role directions based only on the supplied profile and profile_evidence_signals.",
    "Do not use outside job-market data, popularity trends, or assumptions about the user.",
    "Do not state that the user should become a role. Frame each direction as an evidence-backed fit hypothesis.",
    "Every direction must cite supporting_evidence entries whose evidence_id values exist in profile_evidence_signals.",
    "Do not recommend a direction with zero supporting evidence.",
    "Set support_level to strong_fit only when evidence strongly supports the direction; set medium_fit for plausible but incomplete support; set aspirational_gap for possible directions that need important missing evidence.",
    "Clearly separate aspirational_gap directions from currently well-supported directions.",
    "If evidence is weak, lower fit_score/confidence and add specific missing_evidence_questions.",
    "Low or medium confidence directions must include missing_evidence_questions.",
    "Fit scores must reflect evidence strength and role-scope support, not market popularity.",
    "Use role_family values only from: product, data, ai_ml, technical, growth, strategy_ops, other.",
    "Use confidence values only from: low, medium, high.",
    "Use support_level values only from: strong_fit, medium_fit, aspirational_gap.",
    "private_source_quote is provenance for reasoning only; do not reuse private wording as public resume wording.",
    "resume_emphasis should guide a future main resume variant; do not generate the resume itself.",
    "Set generated_at to the current ISO timestamp if available from context; otherwise use a valid ISO timestamp.",
  ]);
}
