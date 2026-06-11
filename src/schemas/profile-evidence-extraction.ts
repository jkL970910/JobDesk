import { z } from "zod";

import { EvidenceItem, ProjectCard } from "./evidence";

const SimpleExtractedField = z.preprocess((value) => {
  if (typeof value === "string") {
    return { value, source_quote: value, confidence: 0.5 };
  }
  return value;
}, z.object({
  value: z.string(),
  source_quote: z.string(),
  confidence: z.number().min(0).max(1).default(0),
}));

const NullableSimpleExtractedField = z.preprocess((value) => {
  if (typeof value === "string" && value.trim()) {
    return { value, source_quote: value, confidence: 0.5 };
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.value == null || record.source_quote == null) return null;
  return record;
}, SimpleExtractedField.nullable());

const LooseSimpleFieldArray = z
  .preprocess((value) => flattenArrayLike(value), z.array(SimpleExtractedField))
  .default([]);

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

export const SimpleProfile = z.object({
  name: SimpleExtractedField,
  email: NullableSimpleExtractedField.default(null),
  phone: NullableSimpleExtractedField.default(null),
  location: NullableSimpleExtractedField.default(null),
  links: LooseSimpleFieldArray,
  experience: z
    .array(
      z.object({
        employer: SimpleExtractedField,
        title: SimpleExtractedField,
        start_date: SimpleExtractedField.nullable().default(null),
        end_date: SimpleExtractedField.nullable().default(null),
        bullets: LooseSimpleFieldArray,
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        institution: NullableSimpleExtractedField.default(null),
        degree: NullableSimpleExtractedField.default(null),
        field_of_study: NullableSimpleExtractedField.default(null),
        start_date: NullableSimpleExtractedField.default(null),
        end_date: NullableSimpleExtractedField.default(null),
      }),
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
  missing_fields: z.array(z.string()).default([]),
  low_confidence_fields: z.array(z.string()).default([]),
  invented_field_flags: z.array(z.string()).default([]),
});
export type SimpleProfile = z.infer<typeof SimpleProfile>;

export const EvidenceDraft = EvidenceItem.omit({
  id: true,
  workspace_id: true,
  source_document_id: true,
  source_offset: true,
}).extend({
  related_project_id: z.string().nullable().default(null),
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

const LooseProjectDraft = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    title: record.title ?? record.name ?? record.project,
  };
}, ProjectDraft);

export const ProfileEvidenceExtraction = z.object({
  profile: SimpleProfile,
  evidence_items: z.array(LooseEvidenceDraft).default([]),
  project_cards: z.array(LooseProjectDraft).default([]),
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
});
export type ProfileEvidenceExtraction = z.infer<typeof ProfileEvidenceExtraction>;
