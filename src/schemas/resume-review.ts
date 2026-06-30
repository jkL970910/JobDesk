/**
 * Resume review schema.
 * Skill ref: skills/hr-screening-review, adapted for general uploaded resumes.
 */
import { z } from "zod";

const TrimmedStringArray = z.array(z.string().trim().min(1)).default([]);

const TextValue = z
  .preprocess((value) => {
    if (typeof value === "string") return value.trim();
    return value;
  }, z.string().trim().min(1));

const ScoreValue = z
  .preprocess((value) => {
    if (typeof value === "string") {
      const parsed = Number(value.match(/\d+(?:\.\d+)?/)?.[0]);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.number())
  .transform((value) => Math.round(Math.max(0, Math.min(100, value))));

const ConfidenceValue = z
  .preprocess((value) => {
    if (typeof value === "string") {
      const parsed = Number(value.match(/\d+(?:\.\d+)?/)?.[0]);
      if (Number.isFinite(parsed)) return parsed > 1 ? parsed / 100 : parsed;
    }
    return value;
  }, z.number())
  .transform((value) => Math.max(0, Math.min(1, value)));

export const ReviewRubricItem = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  score: ScoreValue,
  maxScore: ScoreValue.default(100),
  note: TextValue,
  findings: TrimmedStringArray,
  helpedScore: TrimmedStringArray,
  loweredScore: TrimmedStringArray,
  evidenceQuestions: TrimmedStringArray,
  nextAction: TextValue.optional(),
  raiseScore: TrimmedStringArray,
});

export const ReviewRubricItemInput = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    evidenceQuestions:
      record.evidenceQuestions ??
      record.evidence_questions ??
      record.evidence_to_add ??
      record.evidenceToAdd,
    findings:
      record.findings ??
      record.feedback ??
      record.issues ??
      record.observations,
    helpedScore:
      record.helpedScore ??
      record.helped_score ??
      record.what_helped ??
      record.positive_signals,
    loweredScore:
      record.loweredScore ??
      record.lowered_score ??
      record.deductions ??
      record.what_lowered,
    maxScore: record.maxScore ?? record.max_score ?? record.max,
    note: record.note ?? record.rationale ?? record.reason ?? record.feedback,
    nextAction:
      record.nextAction ??
      record.next_action ??
      record.draftGuidance ??
      record.draft_guidance ??
      record.guidance,
    raiseScore:
      record.raiseScore ??
      record.raise_score ??
      record.what_would_raise_score ??
      record.improvements,
  };
}, ReviewRubricItem);

export const ResumeReviewScore = z.object({
  overall: ScoreValue,
  confidence: ConfidenceValue.default(0.6),
  scope_note: TextValue.default("General resume review without a target JD."),
});

export const ResumeReviewFairnessCheck = z.object({
  applied: z.boolean().default(true),
  note: TextValue.default("No protected or proxy signals were penalized."),
  signals_not_penalized: TrimmedStringArray,
});

export const ResumeReview = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const score =
    record.score && typeof record.score === "object"
      ? (record.score as Record<string, unknown>)
      : {};
  const fairness =
    record.fairness_check && typeof record.fairness_check === "object"
      ? (record.fairness_check as Record<string, unknown>)
      : record.fairnessCheck && typeof record.fairnessCheck === "object"
        ? (record.fairnessCheck as Record<string, unknown>)
        : {};
  return {
    ...record,
    score: {
      ...score,
      scope_note: score.scope_note ?? score.scopeNote ?? record.scope_note ?? record.scopeNote,
    },
    suggested_edits: record.suggested_edits ?? record.suggestedEdits ?? record.recommended_actions,
    ten_second_scan: record.ten_second_scan ?? record.tenSecondScan,
    ats_notes: record.ats_notes ?? record.atsNotes,
    missing_evidence_questions:
      record.missing_evidence_questions ?? record.missingEvidenceQuestions,
    risk_flags: record.risk_flags ?? record.riskFlags,
    fairness_check: {
      ...fairness,
      signals_not_penalized:
        fairness.signals_not_penalized ?? fairness.signalsNotPenalized ?? [],
    },
  };
}, z.object({
  score: ResumeReviewScore,
  rubric: z.array(ReviewRubricItemInput).default([]),
  strengths: TrimmedStringArray,
  weaknesses: TrimmedStringArray,
  suggested_edits: TrimmedStringArray,
  ten_second_scan: TextValue.default("Resume reviewed for general fit and evidence readiness."),
  ats_notes: TrimmedStringArray,
  missing_evidence_questions: TrimmedStringArray,
  risk_flags: TrimmedStringArray,
  fairness_check: ResumeReviewFairnessCheck,
}));
export type ResumeReview = z.infer<typeof ResumeReview>;
