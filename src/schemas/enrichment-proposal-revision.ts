import { z } from "zod";

export const EnrichmentProposalRevision = z.object({
  text: z.string().trim().min(12).max(4000),
  source_quote: z.string().trim().min(1).max(4000).optional(),
});

export type EnrichmentProposalRevision = z.infer<typeof EnrichmentProposalRevision>;
