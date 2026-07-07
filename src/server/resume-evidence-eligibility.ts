import type { AllowedUsage, EvidenceType, SensitivityLevel } from "../schemas/shared";
import { hasResumeSafeDisclosure } from "./deidentification-service";

export type ResumeEvidenceEligibilityBlockerCode =
  | "approval_required"
  | "public_safe_required"
  | "user_confirmation_required"
  | "inferred_evidence_not_allowed"
  | "missing_source_quote"
  | "resume_usage_required"
  | "internal_only_not_allowed"
  | "quarantined_evidence_not_allowed";

export type ResumeEvidenceNextAction =
  | "ready"
  | "review_claim"
  | "add_public_safe_summary"
  | "confirm_claim"
  | "replace_inferred_evidence"
  | "add_source_quote"
  | "enable_resume_usage"
  | "quarantine_restore_required";

export type ResumeEvidenceEligibilityBlocker = {
  code: ResumeEvidenceEligibilityBlockerCode;
  detail: string;
  label: string;
  nextAction: ResumeEvidenceNextAction;
};

export type ResumeEvidenceEligibility = {
  eligible: boolean;
  blockers: ResumeEvidenceEligibilityBlocker[];
  nextAction: ResumeEvidenceNextAction;
  summary: string;
  canUsePublicSafeSummary: boolean;
};

export type ResumeEvidenceEligibilityInput = {
  allowedUsage: AllowedUsage[] | string[];
  evidenceType: EvidenceType | string;
  needsUserConfirmation: boolean;
  publicSafeSummary: string | null;
  quarantinedAt?: Date | string | null;
  sensitivityLevel: SensitivityLevel | string;
  sourceQuote: string | null;
  status: string;
  text: string;
};

export function evaluateResumeEvidenceEligibility(
  input: ResumeEvidenceEligibilityInput,
): ResumeEvidenceEligibility {
  const blockers: ResumeEvidenceEligibilityBlocker[] = [];
  const hasPublicSafeDisclosure = hasResumeSafeDisclosure({
    publicSafeSummary: input.publicSafeSummary,
    sensitivityLevel: input.sensitivityLevel,
    text: input.text,
  });

  if (input.quarantinedAt) {
    blockers.push(blocker("quarantined_evidence_not_allowed"));
  }
  if (input.status !== "approved") {
    blockers.push(blocker("approval_required"));
  }
  if (!hasPublicSafeDisclosure) {
    blockers.push(blocker("public_safe_required"));
  }
  if (input.needsUserConfirmation) {
    blockers.push(blocker("user_confirmation_required"));
  }
  if (input.evidenceType === "inferred") {
    blockers.push(blocker("inferred_evidence_not_allowed"));
  }
  if (!input.sourceQuote?.trim()) {
    blockers.push(blocker("missing_source_quote"));
  }
  if (!input.allowedUsage.includes("resume")) {
    blockers.push(blocker("resume_usage_required"));
  }
  if (input.allowedUsage.includes("internal_only")) {
    blockers.push(blocker("internal_only_not_allowed"));
  }

  const nextAction = blockers[0]?.nextAction ?? "ready";
  return {
    eligible: blockers.length === 0,
    blockers,
    nextAction,
    summary: blockers.length === 0
      ? "Ready for main resume and tailored resume generation."
      : blockers.map((item) => item.label).join("; "),
    canUsePublicSafeSummary: hasPublicSafeDisclosure,
  };
}

function blocker(code: ResumeEvidenceEligibilityBlockerCode): ResumeEvidenceEligibilityBlocker {
  switch (code) {
    case "approval_required":
      return {
        code,
        detail: "Evidence must be reviewed and approved before resume use.",
        label: "Approval required",
        nextAction: "review_claim",
      };
    case "quarantined_evidence_not_allowed":
      return {
        code,
        detail: "Quarantined evidence is preserved for audit but cannot support resume generation.",
        label: "Quarantined evidence blocked",
        nextAction: "quarantine_restore_required",
      };
    case "public_safe_required":
      return {
        code,
        detail: "External-facing resume output needs public-safe wording or public-safe source text.",
        label: "Public-safe wording required",
        nextAction: "add_public_safe_summary",
      };
    case "user_confirmation_required":
      return {
        code,
        detail: "A user must confirm this extracted or edited claim before resume use.",
        label: "User confirmation required",
        nextAction: "confirm_claim",
      };
    case "inferred_evidence_not_allowed":
      return {
        code,
        detail: "Inferred evidence cannot support generated resume claims.",
        label: "Source-backed evidence required",
        nextAction: "replace_inferred_evidence",
      };
    case "missing_source_quote":
      return {
        code,
        detail: "Evidence needs a source quote before it can support generated resume claims.",
        label: "Source quote required",
        nextAction: "add_source_quote",
      };
    case "resume_usage_required":
      return {
        code,
        detail: "Evidence must be explicitly approved for resume usage.",
        label: "Resume usage required",
        nextAction: "enable_resume_usage",
      };
    case "internal_only_not_allowed":
      return {
        code,
        detail: "Internal-only evidence cannot be used in external-facing resume output.",
        label: "Internal-only usage blocked",
        nextAction: "enable_resume_usage",
      };
  }
}
