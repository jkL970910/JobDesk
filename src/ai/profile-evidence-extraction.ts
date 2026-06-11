import { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
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
  return adapter.callStructuredJson({
    task: "profile-evidence-extraction",
    schema: ProfileEvidenceExtraction,
    instructions: buildProfileEvidenceInstructions(params.sourceKind ?? "resume"),
    input: JSON.stringify({
      source_id: params.sourceId,
      source_kind: params.sourceKind ?? "resume",
      source_text: params.sourceText,
    }),
    maxOutputTokens: 2400,
    timeoutMs: 180_000,
  });
}

export function buildProfileEvidenceInstructions(
  sourceKind: "resume" | "project_note" = "resume",
) {
  return [
    "You are JobDesk's Profile Intake and Evidence Curator.",
    sourceKind === "project_note"
      ? "Convert one project note, work summary, or career-note source into reusable evidence drafts and project cards for a personal evidence library."
      : "Convert one resume or career-notes source into structured profile data plus reusable evidence drafts.",
    "Return only one valid JSON object. Do not return markdown.",
    "Use exactly these top-level keys: profile, evidence_items, project_cards, extraction_notes.",
    "profile must use this simple shape: name, email, phone, location, links, experience, education, skills, certifications, missing_fields, low_confidence_fields, invented_field_flags.",
    "Every extracted profile field must include only value, source_quote, and confidence.",
    "Do not include verified, tier, source_offset, contact, or profile_json in the provider output.",
    "profile.name is required. If the source does not state a name, use the first non-empty line and add profile.name to low_confidence_fields.",
    "For experience dates or education fields that are not stated, return null instead of omitting required surrounding objects.",
    "Every source_quote must be a verbatim span from the input. Do not paraphrase source_quote.",
    "Never guess missing contact, dates, employers, titles, schools, metrics, or locations.",
    "If a critical field is missing, add its path to profile.missing_fields instead of inventing it.",
    "Set low confidence fields in profile.low_confidence_fields when the source is ambiguous.",
    "Set invented_field_flags when a tempting value cannot be supported by a quote.",
    "Evidence items must be atomic reusable facts about candidate actions, responsibilities, achievements, skills demonstrated, or grounded metrics.",
    "Every evidence item must use the key text for the reusable fact. Do not use summary, description, or fact instead of text.",
    sourceKind === "project_note"
      ? "Return at most 8 evidence_items. Prefer project actions, outcomes, technical scope, stakeholder work, and grounded metrics that can later support resumes and interviews."
      : "Return at most 6 evidence_items. Prefer the highest-signal facts for resume tailoring.",
    "Evidence item source_quote must support the evidence text. If a metric is not present in the quote, do not store that metric.",
    "Use evidence_type=extracted for facts directly stated by the source and inferred only when the source implies but does not state the fact.",
    "Set needs_user_confirmation=true for inferred evidence.",
    "Use sensitivity_level=private unless the source is clearly already public-safe.",
    "Use status=pending for all evidence_items and project_cards.",
    sourceKind === "project_note"
      ? "Project cards are the primary output. Create one project card when the source describes a coherent project, initiative, launch, migration, analysis, automation, or operating improvement."
      : "Project cards should group repeated evidence around a named project or initiative only when the source supports it.",
    "Every project card must use the key title. Do not use name or project instead of title.",
    sourceKind === "project_note"
      ? "Return at most 3 project_cards. Include missing metric or specificity gaps in extraction_notes as short review prompts."
      : "Return at most 2 project_cards.",
    "Do not include system IDs such as id, workspace_id, source_document_id, or source_offset.",
  ].join("\n");
}
