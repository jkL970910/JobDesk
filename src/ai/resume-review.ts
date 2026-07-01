import {
  ResumeReview,
  ResumeReviewFairnessCheck,
  ResumeReviewScore,
  ReviewRubricItemInput,
} from "../schemas/resume-review";
import { resolveJobDeskAiConfig } from "./config";
import { JobDeskAiError } from "./errors";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import {
  coerceResumeReviewConfidence,
  coerceResumeReviewStringList,
  coerceResumeReviewTextValue,
  normalizeResumeReviewProviderOutput,
  type ResumeReviewProviderStage,
} from "./resume-review-output-normalizer";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike, JobDeskAiUsage, StructuredJsonResult } from "./types";
import { z } from "zod";

export type ResumeReviewSectionKind =
  | "profile"
  | "summary"
  | "work_experience"
  | "projects"
  | "education"
  | "skills"
  | "uncategorized";

export type ResumeReviewSourceSection = {
  id: string;
  kind: ResumeReviewSectionKind;
  title: string;
  text: string;
};

const ResumeReviewDimensionSignal = z.object({
  dimension: z.string().trim().min(1),
  helped: z.array(z.string()).default([]),
  lowered: z.array(z.string()).default([]),
  raise_score: z.array(z.string()).default([]),
});

const ResumeReviewSectionAssessment = withResumeReviewProviderNormalizer("section_assessment", z.object({
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  evidence_questions: z.array(z.string()).default([]),
  ats_notes: z.array(z.string()).default([]),
  risk_flags: z.array(z.string()).default([]),
  dimension_signals: z.array(ResumeReviewDimensionSignal).default([]),
  confidence: z.number().min(0).max(1).default(0.6),
}));

const ResumeReviewScan = withResumeReviewProviderNormalizer("scan", z.object({
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  ten_second_scan: z.string().trim().min(1),
  ats_notes: z.array(z.string()).default([]),
}));

const ResumeReviewRubric = withResumeReviewProviderNormalizer("rubric", z.object({
  score: ResumeReviewScore,
  rubric: z.array(ReviewRubricItemInput).default([]),
  suggested_edits: z.array(z.string()).default([]),
}));

const ResumeReviewRubricDimension = withResumeReviewProviderNormalizer("rubric_dimension", z.object({
  rubric_item: ReviewRubricItemInput,
  suggested_edits: z.array(z.string()).default([]),
}));

const ResumeReviewEvidence = withResumeReviewProviderNormalizer("evidence", z.object({
  missing_evidence_questions: z.array(z.string()).default([]),
  risk_flags: z.array(z.string()).default([]),
  fairness_check: ResumeReviewFairnessCheck,
}));

export type ResumeReviewSectionAssessmentData = z.infer<typeof ResumeReviewSectionAssessment>;
export type ResumeReviewScanData = z.infer<typeof ResumeReviewScan>;
export type ResumeReviewRubricData = z.infer<typeof ResumeReviewRubric>;
export type ResumeReviewRubricDimensionData = z.infer<typeof ResumeReviewRubricDimension>;
export type ResumeReviewEvidenceData = z.infer<typeof ResumeReviewEvidence>;

type StagedResumeReviewResult = StructuredJsonResult<ResumeReview> & {
  stageCount: number;
};

const DEFAULT_RESUME_REVIEW_SECTION_TIMEOUT_MS = 55_000;
const DEFAULT_RESUME_REVIEW_SYNTHESIS_TIMEOUT_MS = 120_000;
const RESUME_REVIEW_SECTION_CHAR_CAP = 1600;

export function resolveResumeReviewStageTimeoutMs(task: string) {
  const envValue = process.env.JOBDESK_RESUME_REVIEW_STAGE_TIMEOUT_MS;
  const parsed = envValue ? Number(envValue) : NaN;
  if (Number.isFinite(parsed) && parsed >= 10_000) return parsed;
  return task.startsWith("general-resume-review-section-")
    ? DEFAULT_RESUME_REVIEW_SECTION_TIMEOUT_MS
    : DEFAULT_RESUME_REVIEW_SYNTHESIS_TIMEOUT_MS;
}

function coerceStringList(value: unknown) {
  return coerceResumeReviewStringList(value);
}

function coerceTextValue(value: unknown) {
  return coerceResumeReviewTextValue(value);
}

function coerceConfidence(value: unknown) {
  return coerceResumeReviewConfidence(value);
}

function withResumeReviewProviderNormalizer<TSchema extends z.ZodTypeAny>(
  stage: ResumeReviewProviderStage,
  schema: TSchema,
) {
  return z.preprocess((value) => normalizeResumeReviewProviderOutput(stage, value).value, schema);
}

export async function reviewResumeWithAi(params: {
  onStatus?: (stage: "scanning" | "scoring" | "evidence_review") => Promise<void>;
  sourceTitle: string;
  sourceText: string;
  fetchFn?: FetchLike;
}): Promise<StagedResumeReviewResult> {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
    maxAttempts: 1,
  });
  const sourceSections = segmentResumeReviewSource(params.sourceText);
  const sectionAssessments = [];
  const usage: JobDeskAiUsage = {};
  let retryCount = 0;

  await params.onStatus?.("scanning");
  for (const section of sourceSections) {
    const assessment = await assessResumeReviewSection({
      adapter,
      resumeTitle: params.sourceTitle,
      section,
    });
    mergeUsage(usage, assessment.usage);
    retryCount += assessment.retryCount;
    sectionAssessments.push({
      ...section,
      assessment: assessment.data,
    });
  }

  const synthesisInput = buildResumeReviewSynthesisInput({
    resumeTitle: params.sourceTitle,
    sections: sectionAssessments,
  });

  const scan = await synthesizeResumeReviewScanWithAi({
    adapter,
    synthesisInput,
  });
  mergeUsage(usage, scan.usage);
  retryCount += scan.retryCount;

  await params.onStatus?.("scoring");
  const rubric = await synthesizeResumeReviewRubricWithAi({
    adapter,
    synthesisInput,
  });
  mergeUsage(usage, rubric.usage);
  retryCount += rubric.retryCount;

  await params.onStatus?.("evidence_review");
  const evidence = await synthesizeResumeReviewEvidenceWithAi({
    adapter,
    synthesisInput,
  });
  mergeUsage(usage, evidence.usage);
  retryCount += evidence.retryCount;

  const data = composeResumeReviewFromStages({
    evidence: evidence.data,
    rubric: rubric.data,
    scan: scan.data,
  });

  return {
    data,
    outputText: JSON.stringify(data),
    retryCount,
    skill: skillRegistry.resumeReviewGeneral,
    stageCount: 4,
    usage,
  };
}

export function createResumeReviewAiAdapter(fetchFn?: FetchLike) {
  return new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn,
    maxAttempts: 1,
  });
}

export async function assessResumeReviewSectionWithAi(args: {
  adapter?: OpenRouterResponsesAdapter;
  resumeTitle: string;
  section: ResumeReviewSourceSection;
}) {
  return assessResumeReviewSection({
    adapter: args.adapter ?? createResumeReviewAiAdapter(),
    resumeTitle: args.resumeTitle,
    section: args.section,
  });
}

export function buildResumeReviewSynthesisInput(args: {
  resumeTitle: string;
  sections: Array<ResumeReviewSourceSection & { assessment: ResumeReviewSectionAssessmentData }>;
}) {
  return JSON.stringify({
    source_title: args.resumeTitle,
    resume_manifest: args.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      character_count: section.text.length,
    })),
    section_assessments: args.sections.map((section) => ({
      ats_notes: section.assessment.ats_notes,
      confidence: section.assessment.confidence,
      dimension_signals: section.assessment.dimension_signals,
      evidence_questions: section.assessment.evidence_questions,
      id: section.id,
      kind: section.kind,
      risk_flags: section.assessment.risk_flags,
      strengths: section.assessment.strengths,
      title: section.title,
      weaknesses: section.assessment.weaknesses,
    })),
  });
}

export async function synthesizeResumeReviewScanWithAi(args: {
  adapter?: OpenRouterResponsesAdapter;
  synthesisInput: string;
}) {
  return callResumeReviewStageWithRetry({
    adapter: args.adapter ?? createResumeReviewAiAdapter(),
    input: args.synthesisInput,
    instructions: buildResumeReviewScanInstructions(),
    maxOutputTokens: 700,
    schema: ResumeReviewScan,
    task: "general-resume-review-scan",
  });
}

export async function synthesizeResumeReviewRubricWithAi(args: {
  adapter?: OpenRouterResponsesAdapter;
  synthesisInput: string;
}) {
  return callResumeReviewStageWithRetry({
    adapter: args.adapter ?? createResumeReviewAiAdapter(),
    input: args.synthesisInput,
    instructions: buildResumeReviewRubricInstructions(),
    maxOutputTokens: 1500,
    schema: ResumeReviewRubric,
    task: "general-resume-review-rubric",
  });
}

export async function synthesizeResumeReviewRubricDimensionWithAi(args: {
  adapter?: OpenRouterResponsesAdapter;
  dimension: ResumeReviewRubricDimensionSpec;
  synthesisInput: string;
}) {
  return callResumeReviewStageWithRetry({
    adapter: args.adapter ?? createResumeReviewAiAdapter(),
    input: JSON.stringify({
      dimension: args.dimension,
      review_context: JSON.parse(args.synthesisInput),
    }),
    instructions: buildResumeReviewRubricDimensionInstructions(args.dimension),
    maxOutputTokens: 650,
    schema: ResumeReviewRubricDimension,
    task: `general-resume-review-rubric-${args.dimension.key}`,
  });
}

export async function synthesizeResumeReviewEvidenceWithAi(args: {
  adapter?: OpenRouterResponsesAdapter;
  synthesisInput: string;
}) {
  return callResumeReviewStageWithRetry({
    adapter: args.adapter ?? createResumeReviewAiAdapter(),
    input: args.synthesisInput,
    instructions: buildResumeReviewEvidenceInstructions(),
    maxOutputTokens: 700,
    schema: ResumeReviewEvidence,
    task: "general-resume-review-evidence",
  });
}

export type ResumeReviewRubricDimensionSpec = {
  key: string;
  label: string;
  focus: string;
};

export const RESUME_REVIEW_RUBRIC_DIMENSIONS: ResumeReviewRubricDimensionSpec[] = [
  {
    key: "readability",
    label: "Readability",
    focus: "first-scan clarity, recruiter scan speed, concise wording, and whether the strongest evidence is easy to notice",
  },
  {
    key: "impact_evidence",
    label: "Impact evidence",
    focus: "quantified outcomes, ownership scope, business/user impact, concrete evidence, and measurable claims",
  },
  {
    key: "project_depth",
    label: "Project depth",
    focus: "depth of projects, implementation specificity, role in delivery, technical decisions, and story completeness",
  },
  {
    key: "ats",
    label: "ATS readiness",
    focus: "ATS-readable structure, keyword clarity, section labels, formatting risks, and parser-friendly wording",
  },
  {
    key: "structure",
    label: "Structure",
    focus: "section order, target headline clarity, role chronology, hierarchy, and whether the resume tells a coherent story",
  },
  {
    key: "evidence_readiness",
    label: "Evidence readiness",
    focus: "signals that can be extracted into reusable evidence, missing proof questions, public-safe wording risks, and material-library readiness",
  },
];

export function consolidateResumeReviewRubricDimensions(args: {
  dimensions: ResumeReviewRubricDimensionData[];
}) {
  const rubric = args.dimensions.map((dimension) => dimension.rubric_item);
  const suggestedEdits = [...new Set(args.dimensions.flatMap((dimension) => dimension.suggested_edits))].slice(0, 8);
  const average =
    rubric.length > 0
      ? Math.round(rubric.reduce((sum, item) => sum + item.score, 0) / rubric.length)
      : 70;
  const hasMaterialGaps = rubric.some(
    (item) =>
      item.loweredScore.length > 0 ||
      item.evidenceQuestions.length > 0 ||
      item.raiseScore.length > 0,
  );
  const overall = hasMaterialGaps ? Math.min(average, 88) : Math.min(average, 95);
  const confidence = rubric.length >= RESUME_REVIEW_RUBRIC_DIMENSIONS.length ? 0.78 : 0.62;
  return ResumeReviewRubric.parse({
    rubric,
    score: {
      confidence,
      overall,
      scope_note: "General resume review without a target JD.",
    },
    suggested_edits: suggestedEdits,
  });
}

export function composeResumeReviewFromStages(args: {
  evidence: ResumeReviewEvidenceData;
  rubric: ResumeReviewRubricData;
  scan: ResumeReviewScanData;
}) {
  return ResumeReview.parse({
    ats_notes: args.scan.ats_notes,
    fairness_check: args.evidence.fairness_check,
    missing_evidence_questions: args.evidence.missing_evidence_questions,
    risk_flags: args.evidence.risk_flags,
    rubric: args.rubric.rubric,
    score: args.rubric.score,
    strengths: args.scan.strengths,
    suggested_edits: args.rubric.suggested_edits,
    ten_second_scan: args.scan.ten_second_scan,
    weaknesses: args.scan.weaknesses,
  });
}

export function calibrateResumeReviewForSectionFallbacks(args: {
  fallbackSectionCount: number;
  review: ResumeReview;
  totalSectionCount: number;
}) {
  if (args.fallbackSectionCount <= 0) return args.review;
  const fallbackNote =
    args.fallbackSectionCount === 1
      ? "1 resume section used low-confidence fallback analysis after the provider timed out."
      : `${args.fallbackSectionCount} resume sections used low-confidence fallback analysis after provider timeouts.`;
  const confidenceCap = args.fallbackSectionCount >= args.totalSectionCount ? 0.35 : 0.55;
  return ResumeReview.parse({
    ...args.review,
    risk_flags: [...args.review.risk_flags, fallbackNote],
    score: {
      ...args.review.score,
      confidence: Math.min(args.review.score.confidence, confidenceCap),
      scope_note: `${args.review.score.scope_note} ${fallbackNote}`,
    },
  });
}

export function isTimedOutResumeReviewSectionAssessment(
  assessment: ResumeReviewSectionAssessmentData,
) {
  return (
    assessment.confidence <= 0.25 &&
    assessment.evidence_questions.some((question) => question.toLowerCase().includes("took too long")) &&
    assessment.risk_flags.some((flag) => flag.toLowerCase().includes("not completed"))
  );
}

async function assessResumeReviewSection(args: {
  adapter: OpenRouterResponsesAdapter;
  resumeTitle: string;
  section: ResumeReviewSourceSection;
}): Promise<StructuredJsonResult<ResumeReviewSectionAssessmentData>> {
  try {
    return await callResumeReviewStageWithRetry({
      adapter: args.adapter,
      input: JSON.stringify({
        resume_title: args.resumeTitle,
        section: args.section,
      }),
      instructions: buildResumeReviewSectionAssessmentInstructions(),
      maxOutputTokens: 620,
      retryTimeout: false,
      schema: ResumeReviewSectionAssessment,
      task: "general-resume-review-section-assessment",
    });
  } catch (error) {
    if (!(error instanceof JobDeskAiError) || error.kind !== "timeout") throw error;
    const data = buildTimedOutSectionAssessment(args.section);
    return {
      data,
      outputText: JSON.stringify(data),
      retryCount: error.retryCount,
      skill: skillRegistry.resumeReviewGeneral,
      usage: {},
    };
  }
}

function buildTimedOutSectionAssessment(section: ResumeReviewSourceSection): ResumeReviewSectionAssessmentData {
  const sectionLabel = section.title || formatResumeReviewSectionKind(section.kind);
  return {
    ats_notes: [],
    confidence: 0.25,
    dimension_signals: [],
    evidence_questions: [
      `${sectionLabel} needs manual review because this section took too long to analyze automatically.`,
    ],
    risk_flags: [
      `${sectionLabel} was preserved as source material, but detailed AI feedback for this section was not completed.`,
    ],
    strengths: [],
    weaknesses: [
      `${sectionLabel} needs manual review before relying on this review for final resume decisions.`,
    ],
  };
}

function formatResumeReviewSectionKind(kind: ResumeReviewSectionKind) {
  return kind.replace(/_/g, " ");
}

export function segmentResumeReviewSource(sourceText: string): ResumeReviewSourceSection[] {
  const normalized = normalizeResumeReviewText(sourceText);
  if (!normalized) return [];
  const blocks = splitResumeReviewBlocks(normalized);
  const sections: ResumeReviewSourceSection[] = [];
  let current: { heading: string; kind: ResumeReviewSectionKind; lines: string[] } = {
    heading: "Profile",
    kind: "profile",
    lines: [],
  };

  for (const block of blocks) {
    const headingKind = classifyResumeReviewHeading(block);
    if (headingKind) {
      pushResumeReviewSection(sections, current);
      current = {
        heading: block,
        kind: headingKind,
        lines: [],
      };
      continue;
    }
    current.lines.push(block);
  }
  pushResumeReviewSection(sections, current);

  return sections.map((section, index) => ({
    ...section,
    id: `${section.kind}-${index + 1}`,
  }));
}

export function buildResumeReviewInstructions() {
  return composeSkillPrompt(skillRegistry.resumeReviewGeneral, [
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
    "rubric should include 4-6 items with key, label, score 0-100, maxScore 100, note, findings, helpedScore, loweredScore, evidenceQuestions, nextAction, and raiseScore.",
    "For each rubric item, helpedScore must explain what supported the score, loweredScore must explain deductions, evidenceQuestions must be specific to that dimension, nextAction must tell the user what to do next, and raiseScore must list changes that would raise the score. Do not put privacy/public-safe questions under project depth unless the project itself contains sensitive wording.",
    "Calibrate strictly: 100 means no meaningful improvement opportunities were found, which should be extremely rare. Scores above 90 require exceptional quantified impact, clear scope, strong readability, and strong evidence depth. Most good resumes should land around 70-88; thin or vague resumes should be lower.",
    "If the resume has any missing metrics, vague responsibilities, unclear project ownership, weak ATS readability, or missing evidence questions, do not return 100 overall and do not give every rubric item full marks.",
    "fairness_check must include applied=true, note, and signals_not_penalized.",
  ]);
}

export function buildResumeReviewSectionAssessmentInstructions() {
  return composeSkillPrompt(skillRegistry.resumeReviewGeneral, [
    "You are JobDesk's HR Screening Reviewer using the skills/hr-screening-review methodology, adapted for a general uploaded resume.",
    "Section assessment stage: review one resume section only. Do not produce the final overall score and do not rewrite the resume.",
    "Return section-local findings only. Use the section kind/title to understand context, but do not assume other sections are missing unless this section itself shows the gap.",
    "Assess strengths, weaknesses, evidence questions, ATS/readability notes, risk flags, dimension signals, and confidence for this section.",
    "dimension_signals should name dimensions such as readability, impact_evidence, project_depth, ats, structure, or evidence_readiness, with helped/lowered/raise_score lists.",
    "Do not penalize protected or proxy signals. If a fairness concern appears, phrase it as a neutral preparation note in risk_flags only if it affects public wording.",
    "Return only JSON with keys: strengths, weaknesses, evidence_questions, ats_notes, risk_flags, dimension_signals, confidence.",
    "Keep findings source-specific and concise. Avoid generic advice that could apply to any resume.",
  ]);
}

export function buildResumeReviewScanInstructions() {
  return composeSkillPrompt(skillRegistry.resumeReviewGeneral, [
    "You are JobDesk's HR Screening Reviewer using the skills/hr-screening-review methodology, adapted for a general uploaded resume.",
    "Stage 1 of 3: recruiter scan synthesis. Review only; do not rewrite the resume.",
    "Use only the resume manifest and section assessments supplied by JobDesk. Do not require raw resume text in this stage.",
    "This is a general resume review with no target JD. Do not produce a JD match score.",
    "Use uncertainty-aware language. Never state hiring outcomes as facts.",
    "Walk the resume in reading order and separate content gaps from presentation gaps.",
    "Return only JSON with keys: strengths, weaknesses, ten_second_scan, ats_notes.",
    "ten_second_scan should describe what a recruiter likely notices in 10 seconds: target clarity, strongest signal, and obvious gap.",
    "ats_notes should focus on scan/readability/keyword structure, not private implementation details.",
    "Keep lists concise but specific to the source resume.",
  ]);
}

export function buildResumeReviewRubricInstructions() {
  return composeSkillPrompt(skillRegistry.resumeReviewGeneral, [
    "You are JobDesk's HR Screening Reviewer using the skills/hr-screening-review methodology, adapted for a general uploaded resume.",
    "Stage 2 of 3: score and dimension rationale synthesis. Review only; do not rewrite the resume.",
    "Use only the resume manifest and section assessments supplied by JobDesk. Do not require raw resume text in this stage.",
    "This is a general resume review with no target JD. Do not produce a JD match score.",
    "Assess baseline resume quality, evidence strength, project depth, ATS readability, clarity, and material-library readiness.",
    "The resume is user-provided source text. Do not validate whether claims are true; flag unsupported, vague, or weakly evidenced claims as questions or deductions.",
    "Return only JSON with keys: score, rubric, suggested_edits.",
    "score must include overall 0-100, confidence 0-1, and scope_note.",
    "rubric should include 4-6 items with key, label, score 0-100, maxScore 100, note, findings, helpedScore, loweredScore, evidenceQuestions, nextAction, and raiseScore.",
    "For each rubric item, helpedScore must explain what supported the score, loweredScore must explain deductions, evidenceQuestions must be specific to that dimension, nextAction must tell the user what to do next, and raiseScore must list changes that would raise the score.",
    "Do not put privacy/public-safe questions under project depth unless the project itself contains sensitive wording.",
    "Calibrate strictly: 100 means no meaningful improvement opportunities were found, which should be extremely rare. Scores above 90 require exceptional quantified impact, clear scope, strong readability, and strong evidence depth. Most good resumes should land around 70-88; thin or vague resumes should be lower.",
    "If the resume has any missing metrics, vague responsibilities, unclear project ownership, weak ATS readability, or missing evidence questions, do not return 100 overall and do not give every rubric item full marks.",
  ]);
}

export function buildResumeReviewRubricDimensionInstructions(dimension: ResumeReviewRubricDimensionSpec) {
  return composeSkillPrompt(skillRegistry.resumeReviewGeneral, [
    "You are JobDesk's HR Screening Reviewer using the skills/hr-screening-review methodology, adapted for a general uploaded resume.",
    "Rubric dimension stage: score exactly one resume review dimension. Review only; do not rewrite the resume.",
    "Use only the resume manifest and section assessments supplied by JobDesk. Do not require raw resume text in this stage.",
    "This is a general resume review with no target JD. Do not produce a JD match score.",
    `Dimension key: ${dimension.key}.`,
    `Dimension label: ${dimension.label}.`,
    `Dimension focus: ${dimension.focus}.`,
    "Return exactly one rubric_item for this dimension and optional suggested_edits.",
    "rubric_item must include key, label, score 0-100, maxScore 100, note, findings, helpedScore, loweredScore, evidenceQuestions, nextAction, and raiseScore.",
    "helpedScore must explain what supported the score; loweredScore must explain deductions; evidenceQuestions must be specific to this dimension.",
    "Calibrate strictly: scores above 90 require exceptional evidence for this dimension. If gaps/questions remain, do not give full marks.",
    "Do not put privacy/public-safe questions under project depth unless the project itself contains sensitive wording.",
    "Return only JSON with keys: rubric_item, suggested_edits.",
  ]);
}

export function buildResumeReviewEvidenceInstructions() {
  return composeSkillPrompt(skillRegistry.resumeReviewGeneral, [
    "You are JobDesk's HR Screening Reviewer using the skills/hr-screening-review methodology, adapted for a general uploaded resume.",
    "Stage 3 of 3: evidence gaps, risk flags, and fairness check synthesis. Review only; do not rewrite the resume.",
    "Use only the resume manifest and section assessments supplied by JobDesk. Do not require raw resume text in this stage.",
    "This is a general resume review with no target JD. Do not produce a JD match score.",
    "Surface missing evidence questions that would help later Evidence Library extraction: metrics, project context, ownership scope, technologies, and public-safe wording.",
    "Apply the fairness rubric. Do not lower the score or label as weakness based on employment gaps, career changes, caregiving/medical leave, non-traditional education, age-correlated signals, or immigration/location unless the user stated a constraint.",
    "If such signals appear, mention them only as neutral preparation notes in fairness_check.signals_not_penalized or omit them.",
    "Return only JSON with keys: missing_evidence_questions, risk_flags, fairness_check.",
    "fairness_check must include applied=true, note, and signals_not_penalized.",
    "Risk flags should be actionable review concerns such as vague evidence, sensitive/internal wording, missing public-safe rewrite, or unsupported claims. Avoid protected-class judgments.",
  ]);
}

async function callResumeReviewStageWithRetry<TSchema extends z.ZodTypeAny>(args: {
  adapter: OpenRouterResponsesAdapter;
  input: string;
  instructions: string;
  maxOutputTokens: number;
  retryTimeout?: boolean;
  schema: TSchema;
  task: string;
}): Promise<StructuredJsonResult<z.infer<TSchema>>> {
  const timeoutMs = resolveResumeReviewStageTimeoutMs(args.task);
  try {
    return await args.adapter.callStructuredJson({
      input: args.input,
      instructions: args.instructions,
      maxOutputTokens: args.maxOutputTokens,
      schema: args.schema,
      skill: skillRegistry.resumeReviewGeneral,
      task: args.task,
      timeoutMs,
    });
  } catch (error) {
    if (!isRetryableResumeReviewStageFailure(error)) throw error;
    if (error instanceof JobDeskAiError && error.kind === "timeout" && args.retryTimeout === false) {
      throw error;
    }
    await sleep(1200);
    try {
      const result = await args.adapter.callStructuredJson({
        input: args.input,
        instructions: args.instructions,
        maxOutputTokens: args.maxOutputTokens,
        schema: args.schema,
        skill: skillRegistry.resumeReviewGeneral,
        task: args.task,
        timeoutMs,
      });
      return { ...result, retryCount: result.retryCount + 1 };
    } catch (retryError) {
      if (isRetryableResumeReviewStageFailure(retryError)) {
        const retryDiagnostics =
          retryError instanceof JobDeskAiError ? retryError.diagnostics : null;
        throw new JobDeskAiError(`Resume review stage timed out during ${args.task}.`, {
          kind: retryError instanceof JobDeskAiError ? retryError.kind : "timeout",
          diagnostics: {
            ...retryDiagnostics,
            inputChars: retryDiagnostics?.inputChars ?? args.input.length,
            instructionsChars: retryDiagnostics?.instructionsChars ?? args.instructions.length,
            maxOutputTokens: retryDiagnostics?.maxOutputTokens ?? args.maxOutputTokens,
            retryCount: 1,
            task: args.task,
          },
          retryCount: 1,
          cause: retryError,
        });
      }
      throw retryError;
    }
  }
}

function isRetryableResumeReviewStageFailure(error: unknown) {
  return (
    error instanceof JobDeskAiError &&
    (error.kind === "timeout" ||
      error.kind === "provider_5xx" ||
      error.kind === "rate_limit" ||
      error.kind === "empty_output")
  );
}

function mergeUsage(target: JobDeskAiUsage, source: JobDeskAiUsage) {
  target.inputTokens = addTokenCount(target.inputTokens, source.inputTokens);
  target.outputTokens = addTokenCount(target.outputTokens, source.outputTokens);
  target.totalTokens = addTokenCount(target.totalTokens, source.totalTokens);
}

function addTokenCount(left?: number | null, right?: number | null) {
  if (left == null && right == null) return undefined;
  return (left ?? 0) + (right ?? 0);
}

function normalizeResumeReviewText(sourceText: string) {
  return sourceText
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitResumeReviewBlocks(text: string) {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length <= 1) return [block.trim()].filter(Boolean);
      return lines;
    })
    .map((block) => block.trim())
    .filter(Boolean);
}

function classifyResumeReviewHeading(text: string): ResumeReviewSectionKind | null {
  const normalized = text.toLowerCase().replace(/[^a-z&/ ]+/g, "").trim();
  if (!normalized || normalized.length > 56) return null;
  if (/^(summary|professional summary|profile|objective)$/.test(normalized)) return "summary";
  if (/^(experience|work experience|professional experience|employment|internships?)$/.test(normalized)) {
    return "work_experience";
  }
  if (/^(projects?|portfolio|portfolio projects?|selected projects?)$/.test(normalized)) return "projects";
  if (/^(education|academic background)$/.test(normalized)) return "education";
  if (/^(skills?|technical skills?|technologies|tools|certifications?|certificates?)$/.test(normalized)) return "skills";
  if (/^(contact|personal information)$/.test(normalized)) return "profile";
  return null;
}

function pushResumeReviewSection(
  sections: ResumeReviewSourceSection[],
  section: { heading: string; kind: ResumeReviewSectionKind; lines: string[] },
) {
  const text = section.lines.join("\n").trim();
  if (!text) return;
  if (section.kind === "work_experience") {
    pushSemanticResumeReviewBlocks(sections, {
      blocks: splitResumeReviewWorkExperienceBlocks(section.lines),
      heading: section.heading,
      kind: section.kind,
    });
    return;
  }
  if (section.kind === "projects") {
    pushSemanticResumeReviewBlocks(sections, {
      blocks: splitResumeReviewProjectBlocks(section.lines),
      heading: section.heading,
      kind: section.kind,
    });
    return;
  }
  for (const chunk of splitResumeReviewSectionByCharacterCap(text, RESUME_REVIEW_SECTION_CHAR_CAP)) {
    sections.push({
      id: "",
      kind: section.kind,
      text: chunk,
      title: section.heading,
    });
  }
}

function pushSemanticResumeReviewBlocks(
  sections: ResumeReviewSourceSection[],
  args: {
    blocks: string[][];
    heading: string;
    kind: ResumeReviewSectionKind;
  },
) {
  for (const block of args.blocks) {
    const text = block.join("\n").trim();
    if (!text) continue;
    const title = buildSemanticResumeReviewSectionTitle(args.heading, block);
    const chunks = splitSemanticResumeReviewBlockWithContext(block, RESUME_REVIEW_SECTION_CHAR_CAP);
    chunks.forEach((chunk, index) => {
      sections.push({
        id: "",
        kind: args.kind,
        text: chunk,
        title: chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title,
      });
    });
  }
}

function splitResumeReviewWorkExperienceBlocks(lines: string[]) {
  const blocks: string[][] = [];
  let current: string[] = [];
  lines.forEach((line, index) => {
    const startsNewRole =
      current.length > 0 && isLikelyWorkExperienceBlockStart(lines, index);
    if (startsNewRole) {
      blocks.push(current);
      current = [line];
      return;
    }
    current.push(line);
  });
  if (current.length) blocks.push(current);
  return blocks;
}

function splitResumeReviewProjectBlocks(lines: string[]) {
  const blocks: string[][] = [];
  let current: string[] = [];
  lines.forEach((line, index) => {
    const startsNewProject =
      current.length > 0 &&
      isLikelySemanticHeader(line) &&
      !hasResumeReviewDateSignal(line) &&
      !hasJobTitleSignal(line) &&
      Boolean(lines[index + 1]);
    if (startsNewProject) {
      blocks.push(current);
      current = [line];
      return;
    }
    current.push(line);
  });
  if (current.length) blocks.push(current);
  return blocks;
}

function isLikelyWorkExperienceBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  const previous = lines[index - 1] ?? "";
  if (!isLikelySemanticHeader(line)) return false;
  if (hasCompanyNameSignal(line) && (hasJobTitleSignal(next) || hasResumeReviewDateSignal(next))) return true;
  return (
    hasJobTitleSignal(line) &&
    hasResumeReviewDateSignal(line) &&
    !hasCompanyNameSignal(previous) &&
    !hasJobTitleSignal(previous)
  );
}

function buildSemanticResumeReviewSectionTitle(heading: string, lines: string[]) {
  const contextLines = getSemanticBlockContextLines(lines);
  if (contextLines.length === 0) return heading;
  return [heading, contextLines.slice(0, 2).join(" · ")].join(" — ");
}

function splitSemanticResumeReviewBlockWithContext(lines: string[], cap: number) {
  const text = lines.join("\n").trim();
  if (text.length <= cap) return [text];
  const contextLines = getSemanticBlockContextLines(lines);
  const detailLines = lines.slice(Math.max(1, contextLines.length));
  const chunks: string[] = [];
  let current = [...contextLines];
  for (const line of detailLines) {
    const next = [...current, line].join("\n");
    if (next.length > cap && current.length > contextLines.length) {
      chunks.push(current.join("\n"));
      current = [...contextLines, line];
    } else {
      current.push(line);
    }
  }
  if (current.length > contextLines.length || chunks.length === 0) {
    chunks.push(current.join("\n"));
  }
  return chunks.flatMap((chunk) => {
    if (chunk.length <= cap) return [chunk];
    const context = contextLines.join("\n");
    const body = chunk.slice(context.length).trim();
    const bodyCap = Math.max(400, cap - context.length - 2);
    const pieces: string[] = [];
    for (let index = 0; index < body.length; index += bodyCap) {
      pieces.push([context, body.slice(index, index + bodyCap).trim()].filter(Boolean).join("\n"));
    }
    return pieces;
  });
}

function getSemanticBlockContextLines(lines: string[]) {
  const context: string[] = [];
  for (const line of lines) {
    if (isResumeReviewBulletLine(line)) break;
    context.push(line);
    if (context.length >= 3) break;
  }
  return context.length > 0 ? context : lines.slice(0, 1);
}

function splitResumeReviewSectionByCharacterCap(text: string, cap: number) {
  if (text.length <= cap) return [text];
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current: string[] = [];
  for (const line of lines) {
    const next = [...current, line].join("\n");
    if (next.length > cap && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks.flatMap((chunk) => {
    if (chunk.length <= cap) return [chunk];
    const pieces: string[] = [];
    for (let index = 0; index < chunk.length; index += cap) {
      pieces.push(chunk.slice(index, index + cap));
    }
    return pieces;
  });
}

function isLikelySemanticHeader(line: string) {
  const trimmed = line.trim();
  if (!trimmed || isResumeReviewBulletLine(trimmed)) return false;
  if (trimmed.length > 120) return false;
  if (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 8) return false;
  return true;
}

function isResumeReviewBulletLine(line: string) {
  return /^\s*(?:[-*•‣]|\d+[.)])\s+/.test(line);
}

function hasCompanyNameSignal(line: string) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  return words.some((word) => /^[A-Z][A-Za-z&.,'-]*$/.test(word) || /^[A-Z]{2,}$/.test(word));
}

function hasJobTitleSignal(line: string) {
  return /\b(engineer|developer|intern|manager|analyst|designer|architect|consultant|researcher|scientist|lead|director|specialist|coordinator|associate|founder|owner|product|software|frontend|front-end|backend|back-end|full-stack|data|machine learning|ml)\b/i.test(
    line,
  );
}

function hasResumeReviewDateSignal(line: string) {
  return /\b(?:19|20)\d{2}\b|\b(?:present|current|now)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/i.test(
    line,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
