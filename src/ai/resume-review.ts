import { ResumeReview } from "../schemas/resume-review";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { skillRegistry } from "./skills-registry";
import type { FetchLike } from "./types";

export async function reviewResumeWithAi(params: {
  sourceTitle: string;
  sourceText: string;
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });
  return adapter.callStructuredJson({
    task: "general-resume-review",
    skill: skillRegistry.resumeReviewGeneral,
    schema: ResumeReview,
    instructions: buildResumeReviewInstructions(),
    input: JSON.stringify({
      source_title: params.sourceTitle,
      resume_text: params.sourceText,
    }),
    maxOutputTokens: 2200,
    timeoutMs: 120_000,
  });
}

export function buildResumeReviewInstructions() {
  return [
    "You are JobDesk's HR Screening Reviewer using the skills/hr-screening-review methodology, adapted for a general uploaded resume.",
    "Review only. Do not rewrite the resume and do not return a replacement resume.",
    "This is a general resume review with no target JD. Do not produce a JD match score. Assess baseline resume quality, evidence strength, project depth, ATS readability, clarity, and material-library readiness.",
    "The resume is user-provided source text. Do not validate whether claims are true; instead flag unsupported, vague, or weakly evidenced claims as questions for the user.",
    "Use uncertainty-aware language: recruiters often scan for X, this may read as Y. Never state hiring outcomes as facts.",
    "Apply the fairness rubric. Do not lower the score or label as weakness based on employment gaps, career changes, caregiving/medical leave, non-traditional education, age-correlated signals, or immigration/location unless the user stated a constraint.",
    "If such signals appear, mention them only as neutral preparation notes in fairness_check.signals_not_penalized or omit them.",
    "Walk the resume in reading order. Separate content gaps from presentation gaps.",
    "Surface missing evidence questions that would help later Evidence Library extraction: metrics, project context, ownership scope, technologies, and public-safe wording.",
    "Return only one JSON object with keys: score, rubric, strengths, weaknesses, suggested_edits, ten_second_scan, ats_notes, missing_evidence_questions, risk_flags, fairness_check.",
    "score must include overall 0-100, confidence 0-1, and scope_note.",
    "rubric should include 4-6 items with key, label, score 0-100, maxScore 100, and note.",
    "Calibrate strictly: 100 means no meaningful improvement opportunities were found, which should be extremely rare. Scores above 90 require exceptional quantified impact, clear scope, strong readability, and strong evidence depth. Most good resumes should land around 70-88; thin or vague resumes should be lower.",
    "If the resume has any missing metrics, vague responsibilities, unclear project ownership, weak ATS readability, or missing evidence questions, do not return 100 overall and do not give every rubric item full marks.",
    "fairness_check must include applied=true, note, and signals_not_penalized.",
  ].join("\n");
}
