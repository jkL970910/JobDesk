/**
 * Shared schema primitives and controlled vocabularies.
 *
 * Source of truth for JobDesk data contracts. Every other schema imports from
 * here so vocabularies (evidence_type, sensitivity_level, etc.) are defined ONCE
 * and cannot drift. JSON Schema is generated from these definitions; do not
 * hand-author JSON.
 *
 * Design refs: design-doc.md §7 (data model), §9.x (component contracts),
 * build-and-learn.md §1.11.3 (ExtractedField pattern).
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Controlled vocabularies (enums) — defined once, reused everywhere.  */
/* ------------------------------------------------------------------ */

/** How a fact entered the system. `inferred` never auto-promotes to confirmed. */
export const EvidenceType = z.enum([
  "original",
  "extracted",
  "user_confirmed",
  "inferred",
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

/** Sensitivity classification, set at creation, carried everywhere. */
export const SensitivityLevel = z.enum([
  "public_safe",
  "private",
  "sensitive",
]);
export type SensitivityLevel = z.infer<typeof SensitivityLevel>;

/** Where an evidence item is allowed to be used. */
export const AllowedUsage = z.enum([
  "resume",
  "interview",
  "cover_letter",
  "internal_only",
]);
export type AllowedUsage = z.infer<typeof AllowedUsage>;

/** Field-priority tier (gate only on the critical tier). */
export const FieldTier = z.enum(["critical", "important", "nice_to_have"]);
export type FieldTier = z.infer<typeof FieldTier>;

/** Lifecycle status for items needing human approval. */
export const ApprovalStatus = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** Non-employer project classification. Work initiatives are modeled separately. */
export const PortfolioProjectType = z.enum([
  "personal_project",
  "academic_project",
  "open_source",
  "freelance",
  "hackathon",
  "general_project",
]);
export type PortfolioProjectType = z.infer<typeof PortfolioProjectType>;

/** Semantic support verdict (Fact Guard Layer B). */
export const SupportStatus = z.enum([
  "unvalidated",
  "supported",
  "partially_supported",
  "unsupported",
  "user_confirmed",
]);
export type SupportStatus = z.infer<typeof SupportStatus>;

/** Claim provenance-ledger status (adds `stale` for revalidation). */
export const ClaimStatus = z.enum([
  "unvalidated",
  "supported",
  "partially_supported",
  "unsupported",
  "user_confirmed",
  "stale",
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

/** Canonical application pipeline states, shared by tracking and dashboards. */
export const ApplicationStatus = z.enum([
  "evaluated",
  "applied",
  "responded",
  "interview",
  "offer",
  "rejected",
  "discarded",
  "skip",
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

/** Job-posting legitimacy assessment tier. */
export const PostingLegitimacyTier = z.enum([
  "high_confidence",
  "proceed_with_caution",
  "suspicious",
]);
export type PostingLegitimacyTier = z.infer<typeof PostingLegitimacyTier>;

/** High-level role archetype used for framing evidence and interview prep. */
export const RoleArchetype = z.enum([
  "ai_platform_llmops",
  "agentic_automation",
  "technical_ai_pm",
  "ai_solutions_architect",
  "ai_forward_deployed",
  "ai_transformation",
  "hybrid",
  "unknown",
]);
export type RoleArchetype = z.infer<typeof RoleArchetype>;

/* ------------------------------------------------------------------ */
/* Core primitives.                                                    */
/* ------------------------------------------------------------------ */

/**
 * A value extracted from a source document, bound to the verbatim text that
 * supports it. The `source_quote` is what lets deterministic code catch a
 * fabricated value (see build-and-learn.md §1.11.4). `source_offset`, `verified`,
 * and `confidence` are filled by our code, not the model.
 */
export const ExtractedField = z.object({
  value: z.string(),
  source_quote: z.string(),
  source_offset: z.number().int().nullable().default(null),
  verified: z.boolean().default(false),
  tier: FieldTier.default("important"),
  confidence: z.number().min(0).max(1).default(0),
});
export type ExtractedField = z.infer<typeof ExtractedField>;

/** A numeric metric that must be grounded in its own source quote. */
export const GroundedMetric = z.object({
  value: z.string(), // e.g. "6 hours/week", "35%"
  source_quote: z.string(),
});
export type GroundedMetric = z.infer<typeof GroundedMetric>;

/** Provenance pointer into a source document. */
export const SourceRef = z.object({
  source_document_id: z.string(),
  source_span: z.string().nullable().default(null),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** ISO timestamp helper (string form for portability). */
export const IsoTimestamp = z.string().datetime();
