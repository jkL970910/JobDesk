import type {
  ResumeRefreshMode,
  ResumeRefreshStyleConstraints,
} from "../schemas/main-resume";
import { MainResumeDraft } from "../schemas/main-resume";
import type { TailoredResumeEvidenceContext } from "./tailored-resume";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";
import type { PositioningDirection } from "../schemas/profile-positioning";

export async function generateMainResumeWithAi(params: {
  profile: Record<string, unknown>;
  evidenceItems: TailoredResumeEvidenceContext[];
  positioningDirection?: PositioningDirection | null;
  refreshContext?: {
    sourceResumeTitle: string;
    sourceResumeText: string;
    mode: ResumeRefreshMode;
    styleConstraints?: ResumeRefreshStyleConstraints;
  } | null;
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
      positioning_direction: params.positioningDirection
        ? toPositioningDirectionInput(params.positioningDirection)
        : null,
      resume_refresh: params.refreshContext
        ? {
            source_resume_title: params.refreshContext.sourceResumeTitle,
            source_resume_text: params.refreshContext.sourceResumeText,
            update_mode: params.refreshContext.mode,
            style_constraints: params.refreshContext.styleConstraints ?? {},
          }
        : null,
    }),
    maxOutputTokens: 3200,
    timeoutMs: 180_000,
  });
}

function toPositioningDirectionInput(direction: PositioningDirection) {
  return {
    id: direction.id,
    target_role: direction.target_role,
    role_family: direction.role_family,
    fit_score: direction.fit_score,
    confidence: direction.confidence,
    positioning_angle: direction.positioning_angle,
    supporting_evidence: direction.supporting_evidence,
    resume_emphasis: direction.resume_emphasis,
    risks: direction.risks,
  };
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
  return composeSkillPrompt(skillRegistry.mainResume, [
    "You are JobDesk's Main Resume Builder.",
    "Return only a valid JSON object. Do not return markdown fences.",
    "Use exactly these top-level keys: title, resume_json, resume_markdown, claims, missing_evidence_questions.",
    "Generate a general-purpose recruiter/networking resume, not a JD-tailored resume.",
    "If positioning_direction is provided, generate a direction-specific Main Resume variant for that role direction while staying evidence-bounded.",
    "If positioning_direction is provided, follow its summary angle, skills emphasis, project ordering guidance, keywords, and deprioritize guidance only where supplied evidence supports the wording.",
    "If resume_refresh is provided, refresh the old resume as an output artifact using the current approved_resume_evidence as the fact source.",
    "For resume_refresh, do not re-extract evidence from source_resume_text and do not treat the old resume as truth when it conflicts with approved_resume_evidence.",
    "For conservative_update, preserve the old resume structure and add only clearly supported updates.",
    "For balanced_rewrite, preserve major sections but improve narrative and prioritization.",
    "For strategic_reposition, rewrite around positioning_direction when provided; if no positioning_direction is provided, keep it as a broader evidence-backed refresh.",
    "Honor resume_refresh style_constraints where they do not conflict with evidence grounding.",
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
  ]);
}
