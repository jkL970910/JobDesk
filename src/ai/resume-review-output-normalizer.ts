export type ResumeReviewProviderStage =
  | "section_assessment"
  | "scan"
  | "rubric"
  | "rubric_dimension"
  | "evidence";

export type ResumeReviewProviderDrift = {
  field: string;
  from: string;
  to: string;
};

export type ResumeReviewProviderNormalizationResult = {
  drift: ResumeReviewProviderDrift[];
  value: unknown;
};

type StringListIntent =
  | "finding"
  | "question"
  | "risk"
  | "signal"
  | "suggested_edit";

export function normalizeResumeReviewProviderOutput(
  stage: ResumeReviewProviderStage,
  raw: unknown,
): ResumeReviewProviderNormalizationResult {
  const drift: ResumeReviewProviderDrift[] = [];
  const value = normalizeStage(stage, raw, drift);
  return { drift, value };
}

export function coerceResumeReviewTextValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const preferred =
    record.summary ??
    record.text ??
    record.note ??
    record.value ??
    record.recruiter_view ??
    record.recruiterView ??
    record.finding ??
    record.answer;
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
  const values = Object.values(record)
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return values.join(" ").trim();
}

export function coerceResumeReviewStringList(
  value: unknown,
  intent: StringListIntent = "finding",
) {
  if (Array.isArray(value)) {
    return value.map((item) => coerceStringListItem(item, intent)).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (value && typeof value === "object") {
    const singleItem = coerceStringListItem(value, intent);
    if (singleItem) return [singleItem];
    return Object.values(value)
      .flatMap((item) => (Array.isArray(item) ? item : [item]))
      .map((item) => coerceStringListItem(item, intent))
      .filter(Boolean);
  }
  return value;
}

export function coerceResumeReviewConfidence(value: unknown) {
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

export function coerceResumeReviewScore(value: unknown) {
  if (typeof value !== "string") return value;
  const parsed = Number(value.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : value;
}

function normalizeStage(
  stage: ResumeReviewProviderStage,
  raw: unknown,
  drift: ResumeReviewProviderDrift[],
) {
  if (!raw || typeof raw !== "object") return raw;
  const record = { ...(raw as Record<string, unknown>) };
  if (stage === "section_assessment") {
    normalizeStringListField(record, "strengths", "finding", drift);
    normalizeStringListField(record, "weaknesses", "finding", drift);
    normalizeStringListField(record, "evidence_questions", "question", drift);
    normalizeStringListField(record, "ats_notes", "finding", drift);
    normalizeStringListField(record, "risk_flags", "risk", drift);
    normalizeDimensionSignals(record, drift);
    normalizeConfidenceField(record, "confidence", drift);
    return record;
  }
  if (stage === "scan") {
    normalizeStringListField(record, "strengths", "finding", drift);
    normalizeStringListField(record, "weaknesses", "finding", drift);
    normalizeStringListField(record, "ats_notes", "finding", drift);
    normalizeTextField(record, "ten_second_scan", drift);
    return record;
  }
  if (stage === "rubric") {
    normalizeScoreObject(record, drift);
    normalizeRubricItems(record, drift);
    normalizeStringListField(record, "suggested_edits", "suggested_edit", drift);
    return record;
  }
  if (stage === "rubric_dimension") {
    normalizeRubricItem(record, "rubric_item", drift);
    normalizeStringListField(record, "suggested_edits", "suggested_edit", drift);
    return record;
  }
  if (stage === "evidence") {
    normalizeStringListField(record, "missing_evidence_questions", "question", drift);
    normalizeStringListField(record, "risk_flags", "risk", drift);
    normalizeFairnessCheck(record, drift);
    return record;
  }
  return record;
}

function normalizeStringListField(
  record: Record<string, unknown>,
  field: string,
  intent: StringListIntent,
  drift: ResumeReviewProviderDrift[],
) {
  const original = record[field];
  const normalized = coerceResumeReviewStringList(original, intent);
  if (normalized !== original) {
    record[field] = normalized;
    pushDrift(drift, field, original, "string[]");
  }
}

function normalizeTextField(
  record: Record<string, unknown>,
  field: string,
  drift: ResumeReviewProviderDrift[],
) {
  const original = record[field];
  const normalized = coerceResumeReviewTextValue(original);
  if (normalized !== original) {
    record[field] = normalized;
    pushDrift(drift, field, original, "string");
  }
}

function normalizeConfidenceField(
  record: Record<string, unknown>,
  field: string,
  drift: ResumeReviewProviderDrift[],
) {
  const original = record[field];
  const normalized = coerceResumeReviewConfidence(original);
  if (normalized !== original) {
    record[field] = normalized;
    pushDrift(drift, field, original, "number");
  }
}

function normalizeScoreObject(record: Record<string, unknown>, drift: ResumeReviewProviderDrift[]) {
  if (!record.score || typeof record.score !== "object") return;
  const score = { ...(record.score as Record<string, unknown>) };
  const originalOverall = score.overall;
  const normalizedOverall = coerceResumeReviewScore(originalOverall);
  if (normalizedOverall !== originalOverall) {
    score.overall = normalizedOverall;
    pushDrift(drift, "score.overall", originalOverall, "number");
  }
  const originalConfidence = score.confidence;
  const normalizedConfidence = coerceResumeReviewConfidence(originalConfidence);
  if (normalizedConfidence !== originalConfidence) {
    score.confidence = normalizedConfidence;
    pushDrift(drift, "score.confidence", originalConfidence, "number");
  }
  normalizeTextField(score, "scope_note", drift);
  record.score = score;
}

function normalizeRubricItems(record: Record<string, unknown>, drift: ResumeReviewProviderDrift[]) {
  if (!Array.isArray(record.rubric)) return;
  record.rubric = record.rubric.map((item, index) =>
    normalizeRubricItemValue(item, `rubric.${index}`, drift),
  );
}

function normalizeRubricItem(
  record: Record<string, unknown>,
  field: string,
  drift: ResumeReviewProviderDrift[],
) {
  record[field] = normalizeRubricItemValue(record[field], field, drift);
}

function normalizeRubricItemValue(
  raw: unknown,
  path: string,
  drift: ResumeReviewProviderDrift[],
) {
  if (!raw || typeof raw !== "object") return raw;
  const item = { ...(raw as Record<string, unknown>) };
  for (const field of ["findings", "helpedScore", "loweredScore", "evidenceQuestions", "raiseScore"]) {
    normalizeStringListField(item, field, field === "evidenceQuestions" ? "question" : "finding", drift);
    normalizeStringListField(item, snakeCase(field), field === "evidenceQuestions" ? "question" : "finding", drift);
  }
  normalizeTextField(item, "note", drift);
  normalizeTextField(item, "nextAction", drift);
  normalizeTextField(item, "next_action", drift);
  const originalScore = item.score;
  const normalizedScore = coerceResumeReviewScore(originalScore);
  if (normalizedScore !== originalScore) {
    item.score = normalizedScore;
    pushDrift(drift, `${path}.score`, originalScore, "number");
  }
  const originalMaxScore = item.maxScore ?? item.max_score;
  const normalizedMaxScore = coerceResumeReviewScore(originalMaxScore);
  if (normalizedMaxScore !== originalMaxScore) {
    if (item.maxScore != null) item.maxScore = normalizedMaxScore;
    if (item.max_score != null) item.max_score = normalizedMaxScore;
    pushDrift(drift, `${path}.maxScore`, originalMaxScore, "number");
  }
  return item;
}

function normalizeDimensionSignals(record: Record<string, unknown>, drift: ResumeReviewProviderDrift[]) {
  const original = record.dimension_signals;
  const signals = Array.isArray(original)
    ? original
    : original && typeof original === "object"
      ? [original]
      : original;
  if (signals !== original) {
    record.dimension_signals = signals;
    pushDrift(drift, "dimension_signals", original, "array");
  }
  if (!Array.isArray(signals)) return;
  record.dimension_signals = signals
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const signal = { ...(item as Record<string, unknown>) };
      normalizeStringListField(signal, "helped", "signal", drift);
      normalizeStringListField(signal, "lowered", "signal", drift);
      normalizeStringListField(signal, "raise_score", "signal", drift);
      if (typeof signal.dimension !== "string" || !signal.dimension.trim()) {
        pushDrift(drift, `dimension_signals.${index}`, signal.dimension, "dropped");
        return null;
      }
      return signal;
    })
    .filter(Boolean);
}

function normalizeFairnessCheck(record: Record<string, unknown>, drift: ResumeReviewProviderDrift[]) {
  if (!record.fairness_check || typeof record.fairness_check !== "object") return;
  const fairness = { ...(record.fairness_check as Record<string, unknown>) };
  normalizeTextField(fairness, "note", drift);
  normalizeStringListField(fairness, "signals_not_penalized", "signal", drift);
  record.fairness_check = fairness;
}

function coerceStringListItem(item: unknown, intent: StringListIntent) {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  const preferred = preferredTextValue(record, intent);
  const preferredText = typeof preferred === "string" ? preferred.trim() : "";
  const section = typeof record.section === "string" ? record.section.trim() : "";
  if (preferredText && section) return `${section}: ${preferredText}`;
  if (preferredText) return preferredText;
  const values = Object.values(record)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return values.join(" ");
}

function preferredTextValue(record: Record<string, unknown>, intent: StringListIntent) {
  if (intent === "suggested_edit") {
    return (
      record.suggestion ??
      record.action ??
      record.proposed_change ??
      record.proposedChange ??
      record.edit ??
      record.text ??
      record.summary ??
      record.note
    );
  }
  if (intent === "question") {
    return record.question ?? record.prompt ?? record.text ?? record.summary ?? record.note;
  }
  if (intent === "risk") {
    return record.risk ?? record.flag ?? record.text ?? record.summary ?? record.note ?? record.finding;
  }
  return record.note ?? record.summary ?? record.text ?? record.value ?? record.finding ?? record.answer;
}

function pushDrift(
  drift: ResumeReviewProviderDrift[],
  field: string,
  from: unknown,
  to: string,
) {
  if (from == null) return;
  drift.push({
    field,
    from: Array.isArray(from) ? "array" : typeof from,
    to,
  });
}

function snakeCase(value: string) {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}
