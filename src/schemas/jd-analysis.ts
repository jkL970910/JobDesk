/**
 * JD Analysis schema (Component 3: JD Analyst).
 * Skill ref: skills/jd-analysis.
 */
import { z } from "zod";

import { PostingLegitimacyTier, RoleArchetype } from "./shared";

const NullableTrimmedString = z
  .preprocess(
    (value) =>
      typeof value === "string"
        ? value.trim() === ""
          ? null
          : value.trim()
        : value,
    z.string().nullable(),
  )
  .default(null);

const TrimmedStringArray = z
  .preprocess(
    (value) =>
      typeof value === "string"
        ? [value]
        : value && typeof value === "object" && !Array.isArray(value)
          ? Object.values(value)
          : value,
    z.array(
      z.preprocess(
        (value) => (typeof value === "string" ? value.trim() : value),
        z.string(),
      ),
    ),
  )
  .transform((items) => items.filter((item) => item.length > 0))
  .default([]);

export const RequirementType = z.enum(["hard", "soft"]);
export type RequirementType = z.infer<typeof RequirementType>;

export const Requirement = z.object({
  text: z.string(),
  source_quote: z.string(),
  requirement_type: RequirementType,
  importance: z.number().min(0).max(1).default(0.5),
  keywords: z.array(z.string()).default([]),
  verified: z.boolean().default(false),
});
export type Requirement = z.infer<typeof Requirement>;

export const JobFacts = z.object({
  company: NullableTrimmedString,
  role_title: NullableTrimmedString,
  level: NullableTrimmedString,
  location: NullableTrimmedString,
  responsibilities: TrimmedStringArray,
  preferred_qualifications: TrimmedStringArray,
});
export type JobFacts = z.infer<typeof JobFacts>;

const StrictLegitimacySignal = z.object({
  signal: z.string(),
  finding: z.string(),
  weight: z.enum(["positive", "neutral", "concerning"]).default("neutral"),
  source: z.enum(["jd_text", "page_snapshot", "search", "user_provided"]).default("jd_text"),
});

export const LegitimacySignal = z.preprocess((value) => {
  if (typeof value === "string") {
    return {
      signal: value,
      finding: value,
      weight: "neutral",
      source: "jd_text",
    };
  }
  return value;
}, StrictLegitimacySignal);
export type LegitimacySignal = z.infer<typeof LegitimacySignal>;

export const JobLegitimacy = z.object({
  tier: PostingLegitimacyTier.default("proceed_with_caution"),
  signals: z.array(LegitimacySignal).default([]),
  context_notes: TrimmedStringArray,
});
export type JobLegitimacy = z.infer<typeof JobLegitimacy>;

export const JDAnalysis = z.object({
  job_id: z.string(),
  original_jd_text: z.string(),
  job_facts: JobFacts.default({}),
  role_archetype: RoleArchetype.default("unknown"),
  job_legitimacy: JobLegitimacy.default({}),
  requirements: z.array(Requirement).default([]),
  role_signals: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  interview_implications: z.array(z.string()).default([]),
});
export type JDAnalysis = z.infer<typeof JDAnalysis>;
