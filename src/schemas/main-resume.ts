/**
 * Main Resume schema.
 *
 * This uses the same generated-resume draft shape as tailored resumes, but the
 * product owner is Profile rather than a specific JD. The persistence container
 * is main_resume_versions, not resume_versions.
 */
import { TailoredResumeDraft } from "./tailored-resume";
import type { z } from "zod";

export const MainResumeDraft = TailoredResumeDraft;
export type MainResumeDraft = z.infer<typeof MainResumeDraft>;
