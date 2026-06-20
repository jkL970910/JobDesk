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
    "Initiative granularity rules: an initiative is one coherent project/story under a role, not a single tool, task, system component, or result.",
    "Do not create separate initiatives for the technology used, the infrastructure built, and the performance outcome when they refer to the same work.",
    "If initiative candidates share the same employer/role, source bullet or adjacent bullets, system/domain, and outcome, merge them into one initiative.",
    "Put tools such as AWS CDK, React, SQL, Kafka, Redis, or Looker into technologies/actions, not separate initiatives.",
    "Put latency, revenue, activation, reliability, cost, or efficiency improvements into results/metrics, not separate initiatives.",
    "Put service/domain context into context/problem. Create separate initiatives only for distinct business problems, systems, ownership scopes, or outcomes.",
    "Every initiative must set work_experience_ref to the exact draft key of the corresponding work_experience: employer + \" · \" + role_title, for example \"Amazon · Software Dev Engineer Intern\".",
    "Use work_experience_ref=null only when the source does not identify the employer/role. Null work_experience_ref means the initiative cannot be safely auto-consolidated with other initiatives.",
    "Bad initiative split: 1. AWS infrastructure provisioning with CDK; 2. Session latency optimization with distributed caching; 3. Distributed cloud caching for high-scale delivery service.",
    "Good initiative: internal_title=\"Distributed caching infrastructure for session latency optimization\"; context/problem=\"High-scale delivery service had session/dependency latency constraints.\"; actions=[\"Provisioned distributed caching infrastructure using AWS CDK.\"]; results=[\"Optimized session latency.\"]; technologies=[\"AWS CDK\", \"distributed cache\"].",
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
