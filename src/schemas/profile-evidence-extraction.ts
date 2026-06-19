import { z } from "zod";

import {
  EvidenceItem,
  Initiative,
  PortfolioProject,
  ProjectCard,
  WorkExperience,
} from "./evidence";
import { PortfolioProjectType } from "./shared";

const ConfidenceValue = z.preprocess((value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const numeric = Number.parseFloat(trimmed.replace("%", ""));
    if (!Number.isFinite(numeric)) {
      const normalized = trimmed.toLowerCase().replace(/[_-]+/g, " ");
      if (normalized.includes("high")) {
        return normalized.includes("very") ? 0.95 : 0.9;
      }
      if (normalized.includes("medium") || normalized.includes("moderate")) {
        return 0.6;
      }
      if (normalized.includes("low")) {
        return normalized.includes("very") ? 0.15 : 0.3;
      }
      if (["unknown", "uncertain", "n/a", "na"].includes(normalized)) {
        return 0;
      }
      return value;
    }
    return trimmed.includes("%") || numeric > 1 ? numeric / 100 : numeric;
  }
  return value;
}, z.number().min(0).max(1));

const SimpleExtractedField = z.preprocess((value) => {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return { value: text, source_quote: text, confidence: 0.5 };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fieldValue = toText(record.value ?? record.text ?? record.name);
    const sourceQuote = toText(record.source_quote ?? record.quote ?? fieldValue);
    if (fieldValue && sourceQuote) {
      return { ...record, value: fieldValue, source_quote: sourceQuote };
    }
  }
  return value;
}, z.object({
  value: z.string(),
  source_quote: z.string(),
  confidence: ConfidenceValue.default(0),
}));

const NullableSimpleExtractedField = z.preprocess((value) => {
  if (
    (typeof value === "string" || typeof value === "number") &&
    String(value).trim()
  ) {
    const text = String(value).trim();
    return { value: text, source_quote: text, confidence: 0.5 };
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const fieldValue = toText(record.value ?? record.text ?? record.name);
  const sourceQuote = toText(record.source_quote ?? record.quote ?? fieldValue);
  if (!fieldValue || !sourceQuote) return null;
  return { ...record, value: fieldValue, source_quote: sourceQuote };
}, SimpleExtractedField.nullable());

const LooseSimpleFieldArray = z
  .preprocess(
    (value) =>
      flattenArrayLike(value).filter(
        (item) =>
          item != null &&
          (typeof item !== "string" || item.trim().length > 0),
      ),
    z.array(SimpleExtractedField),
  )
  .default([]);

const ExperienceItem = z.object({
  employer: NullableSimpleExtractedField.default(null),
  title: NullableSimpleExtractedField.default(null),
  start_date: NullableSimpleExtractedField.default(null),
  end_date: NullableSimpleExtractedField.default(null),
  bullets: LooseSimpleFieldArray,
});

const LooseExperienceItem = z.preprocess((value) => {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return {
      employer: null,
      title: null,
      start_date: null,
      end_date: null,
      bullets: text ? [text] : [],
    };
  }
  return value;
}, ExperienceItem);

const EducationItem = z.object({
  institution: NullableSimpleExtractedField.default(null),
  degree: NullableSimpleExtractedField.default(null),
  field_of_study: NullableSimpleExtractedField.default(null),
  start_date: NullableSimpleExtractedField.default(null),
  end_date: NullableSimpleExtractedField.default(null),
});

const LooseEducationItem = z.preprocess((value) => {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return {
      institution: null,
      degree: text ? text : null,
      field_of_study: null,
      start_date: null,
      end_date: null,
    };
  }
  return value;
}, EducationItem);

function toText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || null;
  }
  if (Array.isArray(value)) {
    return value.map(toText).filter(Boolean).join("; ") || null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      toText(record.value) ??
      toText(record.text) ??
      toText(record.summary) ??
      toText(record.description) ??
      JSON.stringify(record)
    );
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  return flattenArrayLike(value)
    .map(toText)
    .filter((item): item is string => Boolean(item));
}

function toProfileStringList(value: unknown): string[] {
  return preserveObjectArray(value)
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map(toProfileStringListItem)
    .filter((item): item is string => Boolean(item));
}

function toProfileStringListItem(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || null;
  }
  if (Array.isArray(value)) {
    return value.map(toProfileStringListItem).filter(Boolean).join(": ") || null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const primary =
      toText(record.path) ??
      toText(record.field) ??
      toText(record.name) ??
      toText(record.key) ??
      toText(record.value) ??
      toText(record.text);
    const reason =
      toText(record.reason) ??
      toText(record.note) ??
      toText(record.explanation) ??
      toText(record.confidence);
    if (primary && reason && primary !== reason) return `${primary}: ${reason}`;
    return primary ?? reason ?? JSON.stringify(record);
  }
  return null;
}

function flattenArrayLike(value: unknown): unknown[] {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : value == null
        ? []
        : [value];
  return values.flatMap((item) => {
    if (Array.isArray(item)) return flattenArrayLike(item);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.value != null || record.source_quote != null) return [item];
      return flattenArrayLike(Object.values(record));
    }
    return [item];
  });
}

function toLooseObjectArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function preserveObjectArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeEntityArray(
  value: unknown,
  entityName: string,
): { items: unknown[]; warnings: string[] } {
  const rawItems = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];
  const warnings: string[] = [];
  const items = rawItems.filter((item, index) => {
    if (item && typeof item === "object" && !Array.isArray(item)) return true;
    warnings.push(`Dropped invalid ${entityName} item at index ${index}.`);
    return false;
  });
  return { items, warnings };
}

function normalizeProfileEvidenceExtractionInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  const warnings: string[] = [];

  for (const [key, label] of [
    ["work_experiences", "work_experiences"],
    ["initiatives", "initiatives"],
    ["portfolio_projects", "portfolio_projects"],
    ["evidence_items", "evidence_items"],
    ["project_cards", "project_cards"],
  ] as const) {
    const normalized = normalizeEntityArray(record[key], label);
    record[key] = normalized.items;
    warnings.push(...normalized.warnings);
  }

  if (warnings.length > 0) {
    const existingNotes = Array.isArray(record.extraction_notes)
      ? record.extraction_notes
      : record.extraction_notes == null
        ? []
        : [record.extraction_notes];
    record.extraction_notes = [...existingNotes, ...warnings];
  }

  return record;
}

export const SimpleProfile = z.object({
  name: SimpleExtractedField,
  email: NullableSimpleExtractedField.default(null),
  phone: NullableSimpleExtractedField.default(null),
  location: NullableSimpleExtractedField.default(null),
  links: LooseSimpleFieldArray,
  experience: z
    .preprocess(
      (value) => toLooseObjectArray(value),
      z.array(LooseExperienceItem),
    )
    .transform((items) =>
      items.filter(
        (
          item,
        ): item is typeof item & {
          employer: z.infer<typeof SimpleExtractedField>;
          title: z.infer<typeof SimpleExtractedField>;
        } => Boolean(item.employer && item.title),
      ),
    )
    .default([]),
  education: z
    .preprocess(
      (value) => toLooseObjectArray(value),
      z.array(LooseEducationItem),
    )
    .transform((items) =>
      items.filter(
        (
          item,
        ): item is typeof item & {
          institution: z.infer<typeof SimpleExtractedField>;
          degree: z.infer<typeof SimpleExtractedField>;
        } => Boolean(item.institution && item.degree),
      ),
    )
    .default([]),
  skills: LooseSimpleFieldArray,
  certifications: LooseSimpleFieldArray,
  missing_fields: z.preprocess(toProfileStringList, z.array(z.string())).default([]),
  low_confidence_fields: z.preprocess(toProfileStringList, z.array(z.string())).default([]),
  invented_field_flags: z.preprocess(toProfileStringList, z.array(z.string())).default([]),
});
export type SimpleProfile = z.infer<typeof SimpleProfile>;

export const EvidenceDraft = EvidenceItem.omit({
  id: true,
  workspace_id: true,
  source_document_id: true,
  source_offset: true,
}).extend({
  related_project_id: z.string().nullable().default(null),
  related_work_experience_id: z.string().nullable().optional(),
  related_initiative_id: z.string().nullable().optional(),
  related_portfolio_project_id: z.string().nullable().optional(),
});
export type EvidenceDraft = z.infer<typeof EvidenceDraft>;

const LooseEvidenceDraft = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    text: record.text ?? record.summary ?? record.description ?? record.fact,
  };
}, EvidenceDraft);

export const ProjectDraft = ProjectCard.omit({
  id: true,
  workspace_id: true,
});
export type ProjectDraft = z.infer<typeof ProjectDraft>;

export const WorkExperienceDraft = WorkExperience.omit({
  id: true,
  workspace_id: true,
});
export type WorkExperienceDraft = z.infer<typeof WorkExperienceDraft>;

const LooseWorkExperienceDraft = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    employer: toText(record.employer ?? record.company ?? record.organization) ?? "Unknown employer",
    role_title: toText(record.role_title ?? record.roleTitle ?? record.title ?? record.position) ?? "Unknown role",
    team: toText(record.team ?? record.business_unit ?? record.businessUnit),
    location: toText(record.location),
    start_date: toText(record.start_date ?? record.startDate),
    end_date: toText(record.end_date ?? record.endDate),
    summary: toText(record.summary ?? record.context),
  };
}, WorkExperienceDraft);

export const InitiativeDraft = Initiative.omit({
  id: true,
  workspace_id: true,
  work_experience_id: true,
}).extend({
  work_experience_ref: z.string().nullable().default(null),
});
export type InitiativeDraft = z.infer<typeof InitiativeDraft>;

const LooseInitiativeDraft = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sensitivity = record.sensitivity_level ?? record.sensitivityLevel;
  return {
    ...record,
    work_experience_ref: toText(
      record.work_experience_ref ??
        record.workExperienceRef ??
        record.experience_ref ??
        record.experienceRef,
    ),
    internal_title:
      toText(record.internal_title ?? record.internalTitle ?? record.title ?? record.name) ??
      "Untitled work initiative",
    external_safe_title: toText(record.external_safe_title ?? record.externalSafeTitle),
    context: toText(record.context),
    problem: toText(record.problem),
    role: toText(record.role),
    actions: toStringArray(record.actions),
    results: toStringArray(record.results),
    technologies: toStringArray(record.technologies ?? record.tools),
    stakeholders: toStringArray(record.stakeholders),
    external_safe_summary: toText(record.external_safe_summary ?? record.externalSafeSummary),
    sensitivity_level: sensitivity === "public" ? "public_safe" : sensitivity,
    needs_redaction_review:
      record.needs_redaction_review ?? record.needsRedactionReview ?? true,
  };
}, InitiativeDraft);

export const PortfolioProjectDraft = PortfolioProject.omit({
  id: true,
  workspace_id: true,
});
export type PortfolioProjectDraft = z.infer<typeof PortfolioProjectDraft>;

const LoosePortfolioProjectDraft = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const type = toText(record.project_type ?? record.projectType ?? record.type);
  const sensitivity = record.sensitivity_level ?? record.sensitivityLevel;
  return {
    ...record,
    project_type: PortfolioProjectType.safeParse(type).success ? type : "general_project",
    title: toText(record.title ?? record.name ?? record.project) ?? "Untitled portfolio project",
    external_safe_title: toText(record.external_safe_title ?? record.externalSafeTitle),
    context: toText(record.context),
    problem: toText(record.problem),
    role: toText(record.role),
    actions: toStringArray(record.actions),
    results: toStringArray(record.results),
    technologies: toStringArray(record.technologies ?? record.tools),
    stakeholders: toStringArray(record.stakeholders),
    external_safe_summary: toText(record.external_safe_summary ?? record.externalSafeSummary),
    sensitivity_level: sensitivity === "public" ? "public_safe" : sensitivity,
    needs_redaction_review:
      record.needs_redaction_review ?? record.needsRedactionReview ?? false,
  };
}, PortfolioProjectDraft);

const LooseProjectDraft = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    title: toText(record.title ?? record.name ?? record.project) ?? "Untitled project",
    context: toText(record.context),
    problem: toText(record.problem),
    role: toText(record.role),
    actions: toStringArray(record.actions),
    results: toStringArray(record.results),
    technologies: toStringArray(record.technologies ?? record.tools),
    stakeholders: toStringArray(record.stakeholders),
    public_safe_summary: toText(record.public_safe_summary ?? record.publicSafeSummary),
  };
}, ProjectDraft);

export const ProfileEvidenceExtraction = z.preprocess(
  normalizeProfileEvidenceExtractionInput,
  z.object({
    profile: SimpleProfile,
    work_experiences: z
      .preprocess((value) => preserveObjectArray(value), z.array(LooseWorkExperienceDraft))
      .default([]),
    initiatives: z
      .preprocess((value) => preserveObjectArray(value), z.array(LooseInitiativeDraft))
      .default([]),
    portfolio_projects: z
      .preprocess((value) => preserveObjectArray(value), z.array(LoosePortfolioProjectDraft))
      .default([]),
    evidence_items: z
      .preprocess((value) => preserveObjectArray(value), z.array(LooseEvidenceDraft))
      .default([]),
    project_cards: z
      .preprocess((value) => preserveObjectArray(value), z.array(LooseProjectDraft))
      .default([]),
    extraction_notes: z
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
          .map((item) =>
            typeof item === "string" ? item : JSON.stringify(item),
          )
          .filter(Boolean);
      }, z.array(z.string()))
      .default([]),
  }),
);
export type ProfileEvidenceExtraction = z.infer<typeof ProfileEvidenceExtraction>;
