import { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { getProfileEvidenceSkillForSource } from "./skills-registry";
import type { FetchLike } from "./types";

export async function extractProfileEvidenceWithAi(params: {
  sourceId: string;
  sourceText: string;
  sourceKind?: "resume" | "project_note";
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });
  const sourceKind = params.sourceKind ?? "resume";
  return adapter.callStructuredJson({
    task: "profile-evidence-extraction",
    skill: getProfileEvidenceSkillForSource(sourceKind),
    schema: ProfileEvidenceExtraction,
    instructions: buildProfileEvidenceInstructions(sourceKind),
    input: JSON.stringify({
      source_id: params.sourceId,
      source_kind: sourceKind,
      source_text: params.sourceText,
    }),
    maxOutputTokens: 2400,
    timeoutMs: 180_000,
  });
}

export function buildProfileEvidenceInstructions(
  sourceKind: "resume" | "project_note" = "resume",
) {
  return composeSkillPrompt(getProfileEvidenceSkillForSource(sourceKind), [
    "You are JobDesk's Profile Intake and Evidence Curator.",
    sourceKind === "project_note"
      ? "Convert one project note, work summary, or career-note source into reusable evidence drafts, work initiatives, and portfolio projects for a personal evidence library."
      : "Convert one resume or career-notes source into structured profile data plus reusable evidence drafts.",
    "Return only one valid JSON object. Do not return markdown.",
    "Use exactly these top-level keys: profile, work_experiences, initiatives, portfolio_projects, evidence_items, project_cards, extraction_notes.",
    "profile must use this simple shape: name, email, phone, location, links, experience, education, skills, certifications, missing_fields, low_confidence_fields, invented_field_flags.",
    "Every extracted profile field must include only value, source_quote, and confidence.",
    "Every confidence value must be a number from 0 to 1, not a label such as high, medium, or low.",
    "Do not include verified, tier, source_offset, contact, or profile_json in the provider output.",
    "profile.name is required. If the source does not state a name, use the first non-empty line and add profile.name to low_confidence_fields.",
    "For experience dates or education fields that are not stated, return null instead of omitting required surrounding objects.",
    "Every source_quote must be a verbatim span from the input. Do not paraphrase source_quote.",
    "Never guess missing contact, dates, employers, titles, schools, metrics, or locations.",
    "If a critical field is missing, add its path to profile.missing_fields instead of inventing it.",
    "Set low confidence fields in profile.low_confidence_fields when the source is ambiguous.",
    "Set invented_field_flags when a tempting value cannot be supported by a quote.",
    "Model career material with the correct entities: work_experiences are employer/role containers; initiatives are internal work projects or achievement stories under a work experience; portfolio_projects are non-employer personal, academic, open-source, freelance, or hackathon projects.",
    "Do not put employer-internal work into portfolio_projects. Amazon/Huawei/RBC bullets should become work_experiences plus initiatives, not portfolio projects.",
    "For each initiative, use internal_title for the source/internal wording and external_safe_title/external_safe_summary for resume-safe wording. If internal wording may expose confidential details, set needs_redaction_review=true and sensitivity_level=private or sensitive.",
    "For each portfolio project, classify project_type as one of personal_project, academic_project, open_source, freelance, hackathon, general_project.",
    "Evidence items must be atomic reusable facts about candidate actions, responsibilities, achievements, skills demonstrated, or grounded metrics.",
    "Every evidence item must use the key text for the reusable fact. Do not use summary, description, or fact instead of text.",
    sourceKind === "project_note"
      ? "Return at most 8 evidence_items. Prefer project actions, outcomes, technical scope, stakeholder work, and grounded metrics that can later support resumes and interviews."
      : "Return at most 6 evidence_items. Prefer the highest-signal facts for resume tailoring.",
    "Evidence item source_quote must support the evidence text. If a metric is not present in the quote, do not store that metric.",
    "Use evidence_type=extracted for facts directly stated by the source and inferred only when the source implies but does not state the fact.",
    "Set needs_user_confirmation=true for inferred evidence.",
    "Use sensitivity_level=private unless the source is clearly already public-safe.",
    "Evidence items may use related_work_experience_id, related_initiative_id, or related_portfolio_project_id as draft references. Use the exact work experience employer + role title, initiative internal_title, or portfolio project title as the draft reference value. Leave unrelated target refs null.",
    "Use status=pending for all work_experiences, initiatives, portfolio_projects, evidence_items, and legacy project_cards.",
    sourceKind === "project_note"
      ? "For project-note sources, create either one initiative when the note is employer-internal work, or one portfolio_project when the note is personal/academic/open-source/freelance/hackathon work."
      : "For resume sources, extract work_experiences from Experience sections, initiatives from employer-internal achievements, and portfolio_projects only from non-employer Projects sections.",
    "project_cards is legacy compatibility only. Prefer work_experiences, initiatives, and portfolio_projects. Return project_cards=[] unless the source cannot be represented by the new entities.",
    sourceKind === "project_note"
      ? "Return at most 3 total initiatives plus portfolio_projects. Include missing metric, redaction, or specificity gaps in extraction_notes as short review prompts."
      : "Return at most 4 work_experiences, 6 initiatives, and 4 portfolio_projects.",
    "Do not include system IDs such as id, workspace_id, source_document_id, or source_offset.",
  ]);
}
