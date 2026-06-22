import { z } from "zod";

const nonEmptyText = z.string().trim().min(1);
const optionalTextPatch = z.string().trim().min(1).optional();
const confidence = z.enum(["low", "medium", "high"]);
const targetKind = z.enum(["evidence", "initiative", "portfolio_project", "work_experience"]);
const metricPatch = z
  .object({
    label: nonEmptyText,
    value: nonEmptyText,
    source_quote: z.string().trim().min(1).optional(),
  })
  .strict();

export const CreateEvidenceProposalPatch = z
  .object({
    text: nonEmptyText,
    source_quote: nonEmptyText,
    evidence_type: z.literal("user_confirmed"),
    metrics: z.array(z.record(z.unknown())).default([]),
    sensitivity_level: z.literal("private"),
    allowed_usage: z.array(z.string()).default([]),
    public_safe_summary: z.string().trim().min(1).nullable().default(null),
    status: z.literal("pending"),
    related_work_experience_id: z.string().uuid().nullable().default(null),
    related_initiative_id: z.string().uuid().nullable().default(null),
    related_portfolio_project_id: z.string().uuid().nullable().default(null),
    needs_user_confirmation: z.literal(true),
  })
  .strict();

export const ClarifyAssignmentProposalPatch = z
  .object({
    patch_type: z.literal("clarify_assignment").default("clarify_assignment"),
    text: nonEmptyText,
    source_quote: nonEmptyText,
    answer_text: nonEmptyText,
    task_scope: z.enum([
      "evidence_detail",
      "story_context",
      "role_context",
      "source_material",
      "assign_later",
    ]),
    expected_outcome: z.enum([
      "create_evidence",
      "update_evidence",
      "update_story",
      "update_role",
      "clarify_assignment",
      "review_imported_material",
    ]),
    target_summary: nonEmptyText,
    rationale: z.string().trim().min(1).default("Needs a clearer target before canonical update."),
    confidence: confidence.default("low"),
    status: z.literal("pending_review"),
    needs_user_confirmation: z.literal(true),
  })
  .strict();

export const StructuredStoryProposalPatch = z
  .object({
    patch_type: z.literal("update_initiative"),
    target_kind: z.enum(["initiative", "portfolio_project"]),
    target_id: z.string().uuid(),
    title_patch: optionalTextPatch,
    context_patch: optionalTextPatch,
    problem_patch: optionalTextPatch,
    role_patch: optionalTextPatch,
    actions_add: z.array(nonEmptyText).optional(),
    results_add: z.array(nonEmptyText).optional(),
    metrics_add: z.array(metricPatch).optional(),
    technologies_add: z.array(nonEmptyText).optional(),
    stakeholders_add: z.array(nonEmptyText).optional(),
    external_safe_summary_patch: z.string().trim().min(1).nullable().optional(),
    rationale: nonEmptyText,
    confidence,
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.title_patch ||
          value.context_patch ||
          value.problem_patch ||
          value.role_patch ||
          value.external_safe_summary_patch ||
          value.actions_add?.length ||
          value.results_add?.length ||
          value.metrics_add?.length ||
          value.technologies_add?.length ||
          value.stakeholders_add?.length,
      ),
    { message: "Structured story patch must include at least one field change." },
  );

export const StructuredRoleProposalPatch = z
  .object({
    patch_type: z.literal("update_work_experience"),
    target_kind: z.literal("work_experience"),
    target_id: z.string().uuid(),
    summary_patch: optionalTextPatch,
    team_patch: z.string().trim().min(1).nullable().optional(),
    location_patch: z.string().trim().min(1).nullable().optional(),
    date_patch: z
      .object({
        start_date: z.string().trim().min(1).optional(),
        end_date: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    rationale: nonEmptyText,
    confidence,
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.summary_patch ||
          value.team_patch ||
          value.location_patch ||
          value.date_patch?.start_date ||
          value.date_patch?.end_date,
      ),
    { message: "Structured role patch must include at least one field change." },
  );

export const EvidenceUpdateProposalPatch = z
  .object({
    patch_type: z.literal("update_evidence"),
    evidence_id: z.string().uuid(),
    text_patch: optionalTextPatch,
    source_quote_patch: optionalTextPatch,
    public_safe_summary_patch: z.string().trim().min(1).nullable().optional(),
    metrics_add: z.array(z.record(z.unknown())).optional(),
    sensitivity_level_patch: z.enum(["public_safe", "private", "sensitive"]).optional(),
    rationale: nonEmptyText,
    confidence,
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.text_patch ||
          value.source_quote_patch ||
          value.public_safe_summary_patch ||
          value.metrics_add?.length ||
          value.sensitivity_level_patch,
      ),
    { message: "Evidence patch must include at least one field change." },
  );

export const EnrichmentProposalPatch = z.union([
  CreateEvidenceProposalPatch,
  ClarifyAssignmentProposalPatch,
  StructuredStoryProposalPatch,
  StructuredRoleProposalPatch,
  EvidenceUpdateProposalPatch,
]);

export type CreateEvidenceProposalPatch = z.infer<typeof CreateEvidenceProposalPatch>;
export type ClarifyAssignmentProposalPatch = z.infer<typeof ClarifyAssignmentProposalPatch>;
export type StructuredStoryProposalPatch = z.infer<typeof StructuredStoryProposalPatch>;
export type StructuredRoleProposalPatch = z.infer<typeof StructuredRoleProposalPatch>;
export type EvidenceUpdateProposalPatch = z.infer<typeof EvidenceUpdateProposalPatch>;
export type EnrichmentProposalPatch = z.infer<typeof EnrichmentProposalPatch>;

export function parseCreateEvidenceProposalPatch(value: unknown) {
  const result = CreateEvidenceProposalPatch.safeParse(value);
  return result.success ? result.data : null;
}

export function parseClarifyAssignmentProposalPatch(value: unknown) {
  const result = ClarifyAssignmentProposalPatch.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStructuredStoryProposalPatch(value: unknown) {
  const result = StructuredStoryProposalPatch.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStructuredRoleProposalPatch(value: unknown) {
  const result = StructuredRoleProposalPatch.safeParse(value);
  return result.success ? result.data : null;
}

export function parseEvidenceUpdateProposalPatch(value: unknown) {
  const result = EvidenceUpdateProposalPatch.safeParse(value);
  return result.success ? result.data : null;
}
