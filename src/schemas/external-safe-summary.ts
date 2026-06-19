import { z } from "zod";

export const ExternalSafeSummarySuggestion = z.object({
  safe_summary: z.string().trim().min(1).max(1200),
  removed_or_generalized_terms: z
    .array(
      z.object({
        original_span: z.string().trim().min(1).max(200),
        replacement: z.string().trim().min(1).max(200),
        reason: z.string().trim().min(1).max(300),
      }),
    )
    .default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  needs_user_review: z.boolean().default(true),
});

export type ExternalSafeSummarySuggestion = z.infer<
  typeof ExternalSafeSummarySuggestion
>;
