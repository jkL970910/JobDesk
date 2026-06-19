import { TailoredResumeDraft } from "../schemas/tailored-resume";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";

export type TailoredResumeEvidenceContext = {
  id: string;
  text: string;
  source_quote: string;
  metrics: Array<Record<string, unknown>>;
  sensitivity_level: string;
  public_safe_summary: string | null;
  retrieval_score?: number;
  reason_for_selection?: string[];
};

export async function generateTailoredResumeWithAi(params: {
  job: Record<string, unknown>;
  profile: Record<string, unknown>;
  evidenceItems: TailoredResumeEvidenceContext[];
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });
  return adapter.callStructuredJson({
    task: "tailored-resume",
    skill: skillRegistry.tailoredResume,
    schema: TailoredResumeDraft,
    instructions: buildTailoredResumeInstructions(),
    input: JSON.stringify({
      job: params.job,
      profile: params.profile,
      approved_resume_evidence: params.evidenceItems.map(toExternalFacingEvidence),
    }),
    maxOutputTokens: 3200,
    timeoutMs: 180_000,
  });
}

function toExternalFacingEvidence(item: TailoredResumeEvidenceContext) {
  const publicSafeSummary = item.public_safe_summary?.trim();
  return {
    ...item,
    text: publicSafeSummary || item.text,
    public_safe_summary: publicSafeSummary || null,
    external_safe_summary_used: Boolean(publicSafeSummary),
  };
}

export function buildTailoredResumeInstructions() {
  return composeSkillPrompt(skillRegistry.tailoredResume, [
    "You are JobDesk's Resume Tailoring agent.",
    "Return only a valid JSON object. Do not return markdown fences.",
    "Use exactly these top-level keys: title, resume_json, resume_markdown, claims, missing_evidence_questions.",
    "Use only the provided approved_resume_evidence. Do not use outside knowledge and do not invent facts.",
    "For external-facing resume wording, prefer public_safe_summary when present; do not expose private company, client, or internal system names from source_quote.",
    "If external_safe_summary_used is true, use the safe text field for resume_markdown and claims; source_quote remains private provenance only.",
    "Prefer evidence with higher retrieval_score and use reason_for_selection only as relevance guidance, not as factual support.",
    "Every substantive resume bullet must have a matching claim in claims.",
    "Every claim must name exactly one primary_evidence_id from approved_resume_evidence. Put that same id first in evidence_ids.",
    "Each bullet should be supported by one primary evidence item; only add secondary evidence_ids when they support the exact same fact, metric, or scope.",
    "Every claim must use evidence_ids from approved_resume_evidence and source_quotes copied verbatim from source_quote or public_safe_summary on those evidence items.",
    "Do not cite evidence that does not directly support the claim.",
    "Do not merge several small facts into a broader responsibility claim. Avoid umbrella phrases like owned strategy, drove roadmap, led cross-functional initiatives, or end-to-end unless the primary evidence explicitly says that.",
    "Do not add metrics, scale, leadership scope, business impact, or seniority unless the primary evidence directly states it.",
    "If evidence is missing, add a concise question to missing_evidence_questions instead of inventing.",
    "If evidence is thin, write fewer and narrower bullets rather than a complete but weak resume.",
    "Keep resume_markdown concise: contact/profile summary if available, selected skills, experience/project bullets, and job-relevant strengths.",
    "resume_json may be a simple object with sections and bullet arrays.",
    "claims items must use exactly these keys: claim_text, section, primary_evidence_id, evidence_ids, source_quotes, risk_level.",
    "risk_level must be high when a claim is broad, aggregated, uses multiple evidence items, or is only indirectly supported; otherwise use low or medium.",
  ]);
}
