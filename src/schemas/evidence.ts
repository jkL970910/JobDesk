/**
 * Evidence + Project schemas (Component 2: Evidence Curator).
 * Skill refs: skills/evidence-extraction, skills/star-story-extraction,
 * skills/project-deidentification.
 */
import { z } from "zod";
import {
  EvidenceType,
  SensitivityLevel,
  AllowedUsage,
  ApprovalStatus,
  GroundedMetric,
} from "./shared";

export const EvidenceItem = z.object({
  id: z.string(),
  workspace_id: z.string(),
  text: z.string(),
  source_quote: z.string(),
  source_document_id: z.string(),
  source_offset: z.number().int().nullable().default(null),
  evidence_type: EvidenceType,
  metrics: z.array(GroundedMetric).default([]),
  sensitivity_level: SensitivityLevel.default("private"),
  allowed_usage: z.array(AllowedUsage).default([]),
  public_safe_summary: z.string().nullable().default(null),
  status: ApprovalStatus.default("pending"),
  related_project_id: z.string().nullable().default(null),
  // True when the item is inferred and must not auto-promote to confirmed.
  needs_user_confirmation: z.boolean().default(false),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const ProjectCard = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  context: z.string().nullable().default(null),
  problem: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  actions: z.array(z.string()).default([]),
  results: z.array(z.string()).default([]),
  metrics: z.array(GroundedMetric).default([]),
  technologies: z.array(z.string()).default([]),
  stakeholders: z.array(z.string()).default([]),
  public_safe_summary: z.string().nullable().default(null),
  sensitivity_level: SensitivityLevel.default("private"),
  status: ApprovalStatus.default("pending"),
});
export type ProjectCard = z.infer<typeof ProjectCard>;

/** STAR-C story candidate (skills/star-story-extraction). */
export const StarStory = z.object({
  id: z.string(),
  title: z.string(),
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string(),
  constraints: z.string().nullable().default(null),
  evidence_ids: z.array(z.string()).default([]),
  competencies: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0),
  needs_user_confirmation: z.boolean().default(false),
  status: ApprovalStatus.default("pending"),
});
export type StarStory = z.infer<typeof StarStory>;

/** De-identification redaction report entry (skills/project-deidentification). */
export const RedactionEntry = z.object({
  original_span: z.string(),
  replacement: z.string(),
  reason: z.string(),
});
export type RedactionEntry = z.infer<typeof RedactionEntry>;
