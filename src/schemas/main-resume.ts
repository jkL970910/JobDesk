/**
 * Main Resume schema.
 *
 * This uses the same generated-resume draft shape as tailored resumes, but the
 * product owner is Profile rather than a specific JD. The persistence container
 * is main_resume_versions, not resume_versions.
 */
import { TailoredResumeDraft } from "./tailored-resume";
import type { z } from "zod";
import { z as zod } from "zod";

export const MainResumeDraft = TailoredResumeDraft;
export type MainResumeDraft = z.infer<typeof MainResumeDraft>;

export const MainResumeGenerationMode = zod.enum([
  "main_resume",
  "positioning_variant",
  "resume_refresh",
]);
export type MainResumeGenerationMode = z.infer<typeof MainResumeGenerationMode>;

export const ResumeRefreshMode = zod.enum([
  "conservative_update",
  "balanced_rewrite",
  "strategic_reposition",
]);
export type ResumeRefreshMode = z.infer<typeof ResumeRefreshMode>;

export const ResumeRefreshStyleConstraints = zod.object({
  targetLength: zod.enum(["one_page", "standard", "detailed"]).optional(),
  preserveSectionOrder: zod.boolean().optional(),
  tone: zod.enum(["concise", "executive", "technical", "product"]).optional(),
  atsFriendly: zod.boolean().optional(),
});
export type ResumeRefreshStyleConstraints = z.infer<typeof ResumeRefreshStyleConstraints>;
