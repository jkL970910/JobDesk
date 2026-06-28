type ReviewDimensionLike = {
  id: string;
  label: string;
  percent?: number;
};

export type ReviewDimensionDetail = {
  evidencePrompts: string[];
  findings: Array<{
    kind: "action" | "risk" | "strength" | "weakness";
    text: string;
  }>;
  helpedScore: string[];
  loweredScore: string[];
  nextAction: string;
  scoreLabel: "Needs work" | "Moderate" | "Strong";
  wouldRaiseScore: string[];
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
  const helpedScore = findings
    .filter((finding) => finding.kind === "strength")
    .map((finding) => finding.text)
    .slice(0, 2);
  const loweredScore = findings
    .filter((finding) => finding.kind === "weakness" || finding.kind === "risk")
    .map((finding) => finding.text)
    .slice(0, 3);

  return {
    evidencePrompts,
    findings,
    helpedScore: helpedScore.length ? helpedScore : buildFallbackHelpedScore(profile),
    loweredScore: loweredScore.length ? loweredScore : buildFallbackLoweredScore(profile),
    nextAction: buildNextAction(profile),
    scoreLabel: buildScoreLabel(dimension.percent),
    wouldRaiseScore: buildWouldRaiseScore(profile),
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

function buildFallbackHelpedScore(profile: DimensionProfile) {
  if (profile.category === "clarity") return ["Resume is generally scan-friendly."];
  if (profile.category === "project") return ["Project or initiative signals are visible."];
  if (profile.category === "evidence") return ["Resume contains source signals that can become library items."];
  if (profile.category === "impact") return ["Some impact or action evidence is visible."];
  if (profile.category === "privacy") return ["No severe privacy blocker was detected in the quick review."];
  if (profile.category === "ats") return ["Core resume text appears parseable."];
  if (profile.category === "structure") return ["Core resume sections are partially present."];
  return ["Reviewer found usable resume material."];
}

function buildFallbackLoweredScore(profile: DimensionProfile) {
  if (profile.category === "clarity") {
    return [
      "Target role may not be immediately obvious.",
      "Strongest evidence is not prioritized in the first scan.",
    ];
  }
  if (profile.category === "project") {
    return ["Project context, ownership, or measurable result may not be explicit enough."];
  }
  if (profile.category === "evidence") {
    return ["Resume evidence is present, but still needs extraction and review before it is library-ready."];
  }
  if (profile.category === "impact") {
    return ["Some achievements need stronger metrics, scope, or before/after proof."];
  }
  if (profile.category === "privacy") {
    return ["Some bullets may need public-safe wording before reuse."];
  }
  if (profile.category === "ats") {
    return ["Formatting, dates, or headings may need to stay more parser-readable."];
  }
  if (profile.category === "structure") {
    return ["One or more expected sections may be incomplete or hard to scan."];
  }
  return ["Reviewer did not return a detailed deduction breakdown for this dimension."];
}

function buildWouldRaiseScore(profile: DimensionProfile) {
  if (profile.category === "clarity") {
    return [
      "Add a clear target headline.",
      "Move strongest impact bullets higher.",
      "Rewrite unclear or internal bullets into recruiter-readable language.",
    ];
  }
  if (profile.category === "project") {
    return [
      "Name the strongest projects or initiatives.",
      "Add ownership, scope, technical decision, and result for each key story.",
    ];
  }
  if (profile.category === "evidence") {
    return [
      "Create library items from the resume.",
      "Review generated claims before marking anything resume-ready.",
    ];
  }
  if (profile.category === "impact") {
    return [
      "Add measurable outcomes for the strongest achievements.",
      "Connect each metric to ownership and business or technical scope.",
    ];
  }
  if (profile.category === "privacy") {
    return ["Replace internal names or sensitive implementation details with external-safe summaries."];
  }
  if (profile.category === "ats") {
    return ["Keep section labels standard.", "Use clear dates, roles, and bullet structure."];
  }
  if (profile.category === "structure") {
    return ["Fill missing contact, experience, education, or skills sections."];
  }
  return ["Add source-backed context for this dimension."];
}

function buildScoreLabel(percent: number | undefined): ReviewDimensionDetail["scoreLabel"] {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return "Moderate";
  if (percent >= 0.8) return "Strong";
  if (percent >= 0.55) return "Moderate";
  return "Needs work";
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
