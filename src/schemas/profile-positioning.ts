import { z } from "zod";

import { IsoTimestamp } from "./shared";

const nonEmptyStringArray = z
  .array(z.string().trim().min(1))
  .default([])
  .transform((items) => Array.from(new Set(items)));

export const PositioningRoleFamily = z.enum([
  "product",
  "data",
  "ai_ml",
  "technical",
  "growth",
  "strategy_ops",
  "other",
]);
export type PositioningRoleFamily = z.infer<typeof PositioningRoleFamily>;

export const PositioningConfidence = z.enum(["low", "medium", "high"]);
export type PositioningConfidence = z.infer<typeof PositioningConfidence>;

export const PositioningSupportingEvidence = z.object({
  evidence_id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  signal_tags: nonEmptyStringArray,
});
export type PositioningSupportingEvidence = z.infer<
  typeof PositioningSupportingEvidence
>;

export const PositioningDirection = z.object({
  id: z.string().trim().min(1),
  target_role: z.string().trim().min(1),
  role_family: PositioningRoleFamily,
  fit_score: z.number().min(0).max(100),
  confidence: PositioningConfidence,
  positioning_angle: z.string().trim().min(1),
  supporting_evidence: z.array(PositioningSupportingEvidence).default([]),
  evidence_strength_explanation: z.string().trim().min(1),
  missing_evidence_questions: nonEmptyStringArray,
  resume_emphasis: z.object({
    summary_angle: z.string().trim().min(1),
    skills_to_emphasize: nonEmptyStringArray,
    project_ordering_guidance: nonEmptyStringArray,
    keywords: nonEmptyStringArray,
    deprioritize: nonEmptyStringArray,
  }),
  risks: nonEmptyStringArray,
});
export type PositioningDirection = z.infer<typeof PositioningDirection>;

export const ProfilePositioningReport = z.object({
  summary: z.string().trim().min(1),
  generated_at: IsoTimestamp,
  directions: z.array(PositioningDirection).min(1).max(5),
  global_strengths: nonEmptyStringArray,
  global_gaps: nonEmptyStringArray,
});
export type ProfilePositioningReport = z.infer<typeof ProfilePositioningReport>;
