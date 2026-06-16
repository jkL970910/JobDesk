import { MainResumeDraft } from "../schemas/main-resume";
import type { TailoredResumeEvidenceContext } from "./tailored-resume";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";

export async function generateMainResumeWithAi(params: {
  profile: Record<string, unknown>;
  evidenceItems: TailoredResumeEvidenceContext[];
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });
  return adapter.callStructuredJson({
    task: "main-resume",
    skill: skillRegistry.mainResume,
    schema: MainResumeDraft,
    instructions: buildMainResumeInstructions(),
    input: JSON.stringify({
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

export function buildMainResumeInstructions() {
  return [
    "You are JobDesk's Main Resume Builder.",
    "Return only a valid JSON object. Do not return markdown fences.",
    "Use exactly these top-level keys: title, resume_json, resume_markdown, claims, missing_evidence_questions.",
    "Generate a general-purpose recruiter/networking resume, not a JD-tailored resume.",
    "Use only the provided profile and approved_resume_evidence. Do not use outside knowledge and do not invent facts.",
    "For external-facing resume wording, prefer public_safe_summary when present; never expose private company, client, or internal system names from source_quote.",
    "Every substantive resume bullet must have a matching claim in claims.",
    "Every claim must use evidence_ids from approved_resume_evidence and source_quotes copied verbatim from source_quote or public_safe_summary on those evidence items.",
    "Do not cite evidence that does not directly support the claim.",
    "If evidence is missing for an important profile area, add a concise question to missing_evidence_questions instead of inventing.",
    "Keep resume_markdown concise: name/contact/profile summary if available, selected skills, experience/project bullets, and reusable strengths.",
    "resume_json may be a simple object with sections and bullet arrays.",
    "claims items must use exactly these keys: claim_text, section, evidence_ids, source_quotes, risk_level.",
    "risk_level should be high when a claim is broad, aggregated, or only indirectly supported; otherwise use low or medium.",
  ].join("\n");
}
