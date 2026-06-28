/**
 * Resume review schema.
 * Skill ref: skills/hr-screening-review, adapted for general uploaded resumes.
 */
import { z } from "zod";

const TrimmedStringArray = z
  .preprocess((value) => {
    const values = Array.isArray(value)
      ? value
      : value && typeof value === "object"
        ? Object.values(value)
        : value == null
          ? []
          : [value];
    return values
      .flatMap((item) => (Array.isArray(item) ? item : [item]))
      .map((item) => normalizeTextItem(item))
      .filter(Boolean);
  }, z.array(z.string()))
  .default([]);

function normalizeTextItem(item: unknown) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";

  const record = item as Record<string, unknown>;
  const preferred =
    record.note ??
    record.summary ??
    record.text ??
    record.value ??
    record.suggestion ??
    record.question ??
    record.risk ??
    record.action ??
    record.finding;
  const preferredText = typeof preferred === "string" ? preferred.trim() : "";
  const section = typeof record.section === "string" ? record.section.trim() : "";
  if (preferredText && section) return `${section}: ${preferredText}`;
  if (preferredText) return preferredText;

  const values = Object.values(record)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return values.join(" ");
}

const TextValue = z
  .preprocess((value) => {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const preferred =
        record.summary ??
        record.text ??
        record.note ??
        record.value ??
        record.recruiter_view ??
        record.recruiterView;
      if (typeof preferred === "string") return preferred.trim();
      const values = Object.values(record)
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());
      if (values.length > 0) return values.join(" ");
    }
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
      const parsed = Number(value.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed)) return parsed > 1 ? parsed / 100 : parsed;
    }
    return value;
  }, z.number())
  .transform((value) => Math.max(0, Math.min(1, value)));

const ReviewRubricItem = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  score: ScoreValue,
  maxScore: ScoreValue.default(100),
  note: z.string().trim().min(1),
  findings: TrimmedStringArray,
  evidenceQuestions: TrimmedStringArray,
  nextAction: z.string().trim().min(1).optional(),
});

const ReviewRubricItemInput = z.preprocess((value) => {
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
    maxScore: record.maxScore ?? record.max_score ?? record.max,
    note: record.note ?? record.rationale ?? record.reason ?? record.feedback,
    nextAction:
      record.nextAction ??
      record.next_action ??
      record.draftGuidance ??
      record.draft_guidance ??
      record.guidance,
  };
}, ReviewRubricItem);

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
  score: z.object({
    overall: ScoreValue,
    confidence: ConfidenceValue.default(0.6),
    scope_note: TextValue.default("General resume review without a target JD."),
  }),
  rubric: z.array(ReviewRubricItemInput).default([]),
  strengths: TrimmedStringArray,
  weaknesses: TrimmedStringArray,
  suggested_edits: TrimmedStringArray,
  ten_second_scan: TextValue.default("Resume reviewed for general fit and evidence readiness."),
  ats_notes: TrimmedStringArray,
  missing_evidence_questions: TrimmedStringArray,
  risk_flags: TrimmedStringArray,
  fairness_check: z.object({
    applied: z.boolean().default(true),
    note: TextValue.default("No protected or proxy signals were penalized."),
    signals_not_penalized: TrimmedStringArray,
  }),
}));
export type ResumeReview = z.infer<typeof ResumeReview>;
