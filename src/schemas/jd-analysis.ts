/**
 * JD Analysis schema (Component 3: JD Analyst).
 * Skill ref: skills/jd-analysis.
 */
import { z } from "zod";

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

export const JDAnalysis = z.object({
  job_id: z.string(),
  original_jd_text: z.string(),
  requirements: z.array(Requirement).default([]),
  role_signals: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  interview_implications: z.array(z.string()).default([]),
});
export type JDAnalysis = z.infer<typeof JDAnalysis>;
