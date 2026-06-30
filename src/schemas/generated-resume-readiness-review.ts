import { z } from "zod";

export const GeneratedResumeDocumentType = z.enum(["main_resume", "tailored_resume"]);
export type GeneratedResumeDocumentType = z.infer<typeof GeneratedResumeDocumentType>;

export const GeneratedResumeReadinessScope = z.enum([
  "general_readiness",
  "jd_specific_readiness",
]);
export type GeneratedResumeReadinessScope = z.infer<typeof GeneratedResumeReadinessScope>;

export const GeneratedResumeReadinessVerdict = z.enum([
  "ready_to_export",
  "recommended_polish",
  "needs_evidence_before_export",
]);
export type GeneratedResumeReadinessVerdict = z.infer<typeof GeneratedResumeReadinessVerdict>;

export const GeneratedResumeFindingRoute = z.enum([
  "evidence_gap",
  "resume_polish",
  "positioning_gap",
]);
export type GeneratedResumeFindingRoute = z.infer<typeof GeneratedResumeFindingRoute>;

export const GeneratedResumeReadinessFinding = z.object({
  id: z.string().trim().min(1),
  route: GeneratedResumeFindingRoute,
  severity: z.enum(["info", "warning", "blocker"]).default("warning"),
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  suggested_action: z.string().trim().min(1),
  linked_claim_ids: z.array(z.string()).default([]),
});
export type GeneratedResumeReadinessFinding = z.infer<
  typeof GeneratedResumeReadinessFinding
>;

export const GeneratedResumeReadinessReview = z.object({
  document_type: GeneratedResumeDocumentType,
  document_id: z.string().uuid(),
  scope: GeneratedResumeReadinessScope,
  scope_label: z.string().trim().min(1),
  score: z.number().int().min(0).max(100),
  verdict: GeneratedResumeReadinessVerdict,
  summary: z.string().trim().min(1),
  before_after: z
    .object({
      baseline_label: z.string().trim().min(1).nullable().default(null),
      baseline_score: z.number().int().min(0).max(100).nullable().default(null),
      generated_label: z.string().trim().min(1),
      generated_score: z.number().int().min(0).max(100),
      delta: z.number().int().nullable().default(null),
    })
    .default({
      baseline_label: null,
      baseline_score: null,
      generated_label: "Generated readiness review",
      generated_score: 0,
      delta: null,
    }),
  readiness_dimensions: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        label: z.string().trim().min(1),
        score: z.number().int().min(0).max(100),
        rationale: z.string().trim().min(1),
      }),
    )
    .default([]),
  hard_gate_status: z.object({
    fact_guard: z.enum(["passed", "needs_review", "not_run"]),
    public_safe: z.enum(["passed", "needs_review"]),
    export_policy: z.enum(["enabled", "blocked"]),
    blockers: z.array(z.string()).default([]),
  }),
  findings: z.array(GeneratedResumeReadinessFinding).default([]),
  created_at: z.string().trim().min(1),
});
export type GeneratedResumeReadinessReview = z.infer<
  typeof GeneratedResumeReadinessReview
>;

export const GeneratedResumePolishProposal = z.object({
  source_main_resume_id: z.string().uuid(),
  readiness_review_id: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  edits: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        route: GeneratedResumeFindingRoute,
        title: z.string().trim().min(1),
        rationale: z.string().trim().min(1),
        proposed_change: z.string().trim().min(1),
      }),
    )
    .default([]),
  preview_markdown: z.string().trim().min(1),
});
export type GeneratedResumePolishProposal = z.infer<
  typeof GeneratedResumePolishProposal
>;
