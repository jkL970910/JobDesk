import { AllowedUsage } from "../schemas/shared";

export type RetrievalPolicyId =
  | "resume_generation"
  | "interview_prep"
  | "positioning_analysis"
  | "evidence_enrichment";

export type EvidenceStatusPolicy = "approved_only" | "approved_or_pending";

export type EvidenceRetrievalPolicy = {
  id: RetrievalPolicyId;
  allowedUsage?: AllowedUsage;
  externalFacing: boolean;
  excludeInferred: boolean;
  statusPolicy: EvidenceStatusPolicy;
  requireNoUserConfirmation: boolean;
  limit: number;
};

export const retrievalPolicies = {
  resume_generation: {
    id: "resume_generation",
    allowedUsage: "resume",
    externalFacing: true,
    excludeInferred: true,
    statusPolicy: "approved_only",
    requireNoUserConfirmation: true,
    limit: 12,
  },
  interview_prep: {
    id: "interview_prep",
    allowedUsage: "interview",
    externalFacing: false,
    excludeInferred: false,
    statusPolicy: "approved_only",
    requireNoUserConfirmation: true,
    limit: 12,
  },
  positioning_analysis: {
    id: "positioning_analysis",
    externalFacing: false,
    excludeInferred: false,
    statusPolicy: "approved_or_pending",
    requireNoUserConfirmation: false,
    limit: 20,
  },
  evidence_enrichment: {
    id: "evidence_enrichment",
    externalFacing: false,
    excludeInferred: false,
    statusPolicy: "approved_or_pending",
    requireNoUserConfirmation: false,
    limit: 20,
  },
} satisfies Record<RetrievalPolicyId, EvidenceRetrievalPolicy>;

export function getRetrievalPolicy(
  id: RetrievalPolicyId,
  overrides: Partial<Omit<EvidenceRetrievalPolicy, "id">> = {},
): EvidenceRetrievalPolicy {
  return { ...retrievalPolicies[id], ...overrides };
}
