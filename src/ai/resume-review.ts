import {
  ResumeReview,
  ResumeReviewFairnessCheck,
  ResumeReviewScore,
  ReviewRubricItemInput,
} from "../schemas/resume-review";
import { resolveJobDeskAiConfig } from "./config";
import { JobDeskAiError } from "./errors";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import { composeSkillPrompt } from "./skill-prompt-composer";
import { skillRegistry } from "./skills-registry";
import type { FetchLike, JobDeskAiUsage, StructuredJsonResult } from "./types";
import { z } from "zod";

type ResumeReviewSectionKind =
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
  helped: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  lowered: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  raise_score: z.preprocess(coerceStringList, z.array(z.string()).default([])),
});

const ResumeReviewSectionAssessment = z.object({
  strengths: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  weaknesses: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  evidence_questions: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  ats_notes: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  risk_flags: z.preprocess(coerceStringList, z.array(z.string()).default([])),
  dimension_signals: z.preprocess(
    coerceDimensionSignals,
    z.array(ResumeReviewDimensionSignal).default([]),
  ),
  confidence: z.preprocess(coerceConfidence, z.number().min(0).max(1).default(0.6)),
});

const ResumeReviewScan = z.object({
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  ten_second_scan: z.string().trim().min(1),
  ats_notes: z.array(z.string()).default([]),
});

const ResumeReviewRubric = z.object({
  score: ResumeReviewScore,
  rubric: z.array(ReviewRubricItemInput).default([]),
  suggested_edits: z.array(z.string()).default([]),
});

const ResumeReviewEvidence = z.object({
  missing_evidence_questions: z.array(z.string()).default([]),
  risk_flags: z.array(z.string()).default([]),
  fairness_check: ResumeReviewFairnessCheck,
});

type StagedResumeReviewResult = StructuredJsonResult<ResumeReview> & {
  stageCount: number;
};

function coerceStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return value;
}

function coerceDimensionSignals(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return value;
}

function coerceConfidence(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return value;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric > 1 ? numeric / 100 : numeric;
  if (["high", "strong"].includes(normalized)) return 0.8;
  if (["medium", "moderate", "mid"].includes(normalized)) return 0.6;
  if (["low", "weak"].includes(normalized)) return 0.35;
  return value;
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
    const assessment = await callResumeReviewStageWithRetry({
      adapter,
      input: JSON.stringify({
        resume_title: params.sourceTitle,
        section,
      }),
      instructions: buildResumeReviewSectionAssessmentInstructions(),
      maxOutputTokens: 700,
      schema: ResumeReviewSectionAssessment,
      task: "general-resume-review-section-assessment",
    });
    mergeUsage(usage, assessment.usage);
    retryCount += assessment.retryCount;
    sectionAssessments.push({
      ...section,
      assessment: assessment.data,
    });
  }

  const synthesisInput = JSON.stringify({
    source_title: params.sourceTitle,
    resume_manifest: sourceSections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      character_count: section.text.length,
    })),
    section_assessments: sectionAssessments.map((section) => ({
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

  const scan = await callResumeReviewStageWithRetry({
    adapter,
    input: synthesisInput,
    instructions: buildResumeReviewScanInstructions(),
    maxOutputTokens: 700,
    schema: ResumeReviewScan,
    task: "general-resume-review-scan",
  });
  mergeUsage(usage, scan.usage);
  retryCount += scan.retryCount;

  await params.onStatus?.("scoring");
  const rubric = await callResumeReviewStageWithRetry({
    adapter,
    input: synthesisInput,
    instructions: buildResumeReviewRubricInstructions(),
    maxOutputTokens: 1500,
    schema: ResumeReviewRubric,
    task: "general-resume-review-rubric",
  });
  mergeUsage(usage, rubric.usage);
  retryCount += rubric.retryCount;

  await params.onStatus?.("evidence_review");
  const evidence = await callResumeReviewStageWithRetry({
    adapter,
    input: synthesisInput,
    instructions: buildResumeReviewEvidenceInstructions(),
    maxOutputTokens: 700,
    schema: ResumeReviewEvidence,
    task: "general-resume-review-evidence",
  });
  mergeUsage(usage, evidence.usage);
  retryCount += evidence.retryCount;

  const data = ResumeReview.parse({
    ats_notes: scan.data.ats_notes,
    fairness_check: evidence.data.fairness_check,
    missing_evidence_questions: evidence.data.missing_evidence_questions,
    risk_flags: evidence.data.risk_flags,
    rubric: rubric.data.rubric,
    score: rubric.data.score,
    strengths: scan.data.strengths,
    suggested_edits: rubric.data.suggested_edits,
    ten_second_scan: scan.data.ten_second_scan,
    weaknesses: scan.data.weaknesses,
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
    "dimension_signals should name dimensions such as readability, impact_evidence, project_depth, ats, structure, or resume_evidence_signals, with helped/lowered/raise_score lists.",
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
  schema: TSchema;
  task: string;
}): Promise<StructuredJsonResult<z.infer<TSchema>>> {
  try {
    return await args.adapter.callStructuredJson({
      input: args.input,
      instructions: args.instructions,
      maxOutputTokens: args.maxOutputTokens,
      schema: args.schema,
      skill: skillRegistry.resumeReviewGeneral,
      task: args.task,
      timeoutMs: 55_000,
    });
  } catch (error) {
    if (!isRetryableResumeReviewStageFailure(error)) throw error;
    await sleep(1200);
    try {
      const result = await args.adapter.callStructuredJson({
        input: args.input,
        instructions: args.instructions,
        maxOutputTokens: args.maxOutputTokens,
        schema: args.schema,
        skill: skillRegistry.resumeReviewGeneral,
        task: args.task,
        timeoutMs: 55_000,
      });
      return { ...result, retryCount: result.retryCount + 1 };
    } catch (retryError) {
      if (isRetryableResumeReviewStageFailure(retryError)) {
        throw new JobDeskAiError(`Resume review stage timed out during ${args.task}.`, {
          kind: retryError instanceof JobDeskAiError ? retryError.kind : "timeout",
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
  for (const chunk of splitResumeReviewSectionByCharacterCap(text, 3200)) {
    sections.push({
      id: "",
      kind: section.kind,
      text: chunk,
      title: section.heading,
    });
  }
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
