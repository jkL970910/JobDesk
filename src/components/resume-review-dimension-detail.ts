type ReviewDimensionLike = {
  id: string;
  label: string;
};

export type ReviewDimensionDetail = {
  evidencePrompts: string[];
  findings: Array<{
    kind: "action" | "risk" | "strength" | "weakness";
    text: string;
  }>;
  nextAction: string;
};

export function buildDimensionDetail({
  dimension,
  missingEvidenceQuestions,
  recommendedActions,
  riskFlags,
  strengths,
  weaknesses,
}: {
  dimension: ReviewDimensionLike;
  missingEvidenceQuestions: string[];
  recommendedActions: string[];
  riskFlags: string[];
  strengths: string[];
  weaknesses: string[];
}): ReviewDimensionDetail {
  const profile = classifyDimension(dimension);
  const findings = [
    ...matchedFindings(strengths, profile, "strength" as const),
    ...matchedFindings(weaknesses, profile, "weakness" as const),
    ...matchedFindings(recommendedActions, profile, "action" as const),
    ...matchedFindings(riskFlags, profile, "risk" as const),
  ].slice(0, 3);
  const evidencePrompts = missingEvidenceQuestions
    .filter((question) => matchesDimension(question, profile))
    .slice(0, 3);

  return {
    evidencePrompts,
    findings,
    nextAction: buildNextAction(profile),
  };
}

function matchedFindings(
  items: string[],
  profile: DimensionProfile,
  kind: ReviewDimensionDetail["findings"][number]["kind"],
) {
  return items
    .filter((item) => matchesDimension(item, profile))
    .map((text) => ({ kind, text }));
}

type DimensionProfile = {
  category:
    | "ats"
    | "clarity"
    | "evidence"
    | "impact"
    | "privacy"
    | "project"
    | "structure"
    | "unknown";
  label: string;
  tokens: string[];
};

function classifyDimension(dimension: ReviewDimensionLike): DimensionProfile {
  const label = normalize(`${dimension.id} ${dimension.label}`);
  if (containsAny(label, ["project", "portfolio", "initiative", "depth"])) {
    return {
      category: "project",
      label,
      tokens: ["project", "portfolio", "initiative", "depth", "ownership", "owned", "built", "launched"],
    };
  }
  if (containsAny(label, ["privacy", "confidential", "risk", "external-safe", "public-safe"])) {
    return {
      category: "privacy",
      label,
      tokens: ["privacy", "confidential", "sensitive", "public", "external", "safe", "rewrite", "share"],
    };
  }
  if (containsAny(label, ["impact", "metric", "evidence", "result"])) {
    return {
      category: label.includes("evidence") ? "evidence" : "impact",
      label,
      tokens: ["impact", "metric", "quantified", "outcome", "result", "evidence", "proof"],
    };
  }
  if (containsAny(label, ["ats", "keyword", "parser"])) {
    return {
      category: "ats",
      label,
      tokens: ["ats", "keyword", "parser", "format", "section"],
    };
  }
  if (containsAny(label, ["clarity", "readability", "scan"])) {
    return {
      category: "clarity",
      label,
      tokens: ["clarity", "readability", "scan", "vague", "wording", "bullet"],
    };
  }
  if (containsAny(label, ["structure", "section"])) {
    return {
      category: "structure",
      label,
      tokens: ["structure", "section", "contact", "education", "skills", "experience"],
    };
  }
  return {
    category: "unknown",
    label,
    tokens: label.split(" ").filter((token) => token.length >= 4),
  };
}

function matchesDimension(value: string, profile: DimensionProfile) {
  const text = normalize(value);
  if (!text) return false;

  if (profile.category === "project") {
    if (isPrivacyText(text)) return false;
    return containsAny(text, [
      ...profile.tokens,
      "context",
      "scope",
      "action",
      "result",
      "story",
      "system",
      "platform",
      "migration",
      "automation",
      "dashboard",
    ]);
  }

  if (profile.category === "privacy") {
    return isPrivacyText(text);
  }

  if (profile.category === "unknown") {
    return containsAny(text, profile.tokens);
  }

  return containsAny(text, profile.tokens);
}

function buildNextAction(profile: DimensionProfile) {
  if (profile.category === "project") {
    return "Add source-backed project context: ownership, scope, technical decisions, and measurable results.";
  }
  if (profile.category === "privacy") {
    return "Rewrite internal or sensitive details into external-safe language before approving resume-ready evidence.";
  }
  if (profile.category === "impact" || profile.category === "evidence") {
    return "Attach measurable outcomes or source-backed proof before using these claims in a resume draft.";
  }
  if (profile.category === "ats") {
    return "Keep section labels, dates, and bullets parser-readable before exporting or tailoring.";
  }
  if (profile.category === "clarity") {
    return "Make the first scan obvious: target role, strongest scope, and highest-impact bullets.";
  }
  if (profile.category === "structure") {
    return "Fill missing resume sections before relying on generated resume drafts.";
  }
  return "Use the reviewer note and matched findings to decide what source material to add next.";
}

function isPrivacyText(text: string) {
  return containsAny(text, [
    "confidential",
    "external safe",
    "external-safe",
    "internal",
    "nda",
    "privacy",
    "public",
    "safe to share",
    "sensitive",
    "share publicly",
  ]);
}

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
