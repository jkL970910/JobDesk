/**
 * Tailored Resume + Generated Claim schemas (Components 5 & 6).
 * The claim is the unit of the provenance ledger: every generated bullet maps to
 * evidence and carries a lifecycle status that Fact Guard + revalidation update.
 * Skill refs: skills/resume-tailoring, skills/claim-support-judgment.
 */
import { z } from "zod";
import { SupportStatus, ClaimStatus, IsoTimestamp } from "./shared";

const nonEmptyStringArray = z
  .array(z.string().trim().min(1))
  .default([])
  .transform((items) => Array.from(new Set(items)));

/** One generated claim (e.g., a resume bullet) and its evidence mapping. */
export const GeneratedClaim = z.object({
  id: z.string(),
  generated_document_id: z.string().nullable().default(null),
  resume_version_id: z.string().nullable().default(null),
  claim_text: z.string(),
  section: z.string(),
  // Non-empty unless the claim is explicitly user_confirmed.
  evidence_ids: z.array(z.string()).default([]),
  source_quotes: z.array(z.string()).default([]),
  support_status: SupportStatus.default("unvalidated"),
  // Living-ledger status (adds `stale` on evidence change).
  claim_status: ClaimStatus.default("unvalidated"),
  risk_level: z.enum(["low", "medium", "high"]).default("low"),
  stale_reason: z.string().nullable().default(null),
  last_validated_at: IsoTimestamp.nullable().default(null),
});
export type GeneratedClaim = z.infer<typeof GeneratedClaim>;

export const TailoredResume = z.object({
  id: z.string(),
  workspace_id: z.string(),
  job_id: z.string(),
  title: z.string(),
  // Structured resume content (sections/bullets). Kept permissive for MVP; a
  // stricter resume-content schema can be introduced later.
  resume_json: z.record(z.unknown()),
  resume_markdown: z.string(),
  claims: z.array(GeneratedClaim).default([]),
  missing_evidence_questions: z.array(z.string()).default([]),
  version: z.number().int().default(1),
  status: z.enum(["draft", "unvalidated", "validated", "exported"]).default("unvalidated"),
});
export type TailoredResume = z.infer<typeof TailoredResume>;

export const GeneratedClaimDraft = z.object({
  claim_text: z.string().trim().min(1),
  section: z.string().trim().min(1),
  evidence_ids: nonEmptyStringArray,
  source_quotes: nonEmptyStringArray,
  risk_level: z.enum(["low", "medium", "high"]).default("low"),
});
export type GeneratedClaimDraft = z.infer<typeof GeneratedClaimDraft>;

export const TailoredResumeDraft = z.object({
  title: z.string().trim().min(1).default("Tailored resume draft"),
  resume_json: z.record(z.unknown()).default({}),
  resume_markdown: z.string().trim().min(1),
  claims: z.array(GeneratedClaimDraft).default([]),
  missing_evidence_questions: nonEmptyStringArray,
});
export type TailoredResumeDraft = z.infer<typeof TailoredResumeDraft>;
