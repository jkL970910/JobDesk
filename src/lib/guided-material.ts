export type GuidedMaterialFields = {
  projectOrInitiativeTitle: string;
  companyOrContext: string;
  roleAndTimeframe: string;
  problem: string;
  ownership: string;
  actions: string;
  metricsBefore: string;
  metricsAfter: string;
  businessImpact: string;
  userOrCustomerImpact: string;
  toolsAndDomainKnowledge: string;
  difficultyOrTradeoff: string;
  publicSafeWording: string;
  confidentialDetailsToAvoid: string;
};

export type GuidedMaterialTarget = {
  targetTitle: string;
  targetType?: "initiative" | "portfolio_project" | "legacy_project";
  missingFields?: string[];
};

export const emptyGuidedMaterialFields: GuidedMaterialFields = {
  actions: "",
  businessImpact: "",
  companyOrContext: "",
  confidentialDetailsToAvoid: "",
  difficultyOrTradeoff: "",
  metricsAfter: "",
  metricsBefore: "",
  ownership: "",
  problem: "",
  projectOrInitiativeTitle: "",
  publicSafeWording: "",
  roleAndTimeframe: "",
  toolsAndDomainKnowledge: "",
  userOrCustomerImpact: "",
};

const substantiveGuidedFields: Array<keyof GuidedMaterialFields> = [
  "actions",
  "businessImpact",
  "companyOrContext",
  "difficultyOrTradeoff",
  "metricsAfter",
  "metricsBefore",
  "ownership",
  "problem",
  "publicSafeWording",
  "roleAndTimeframe",
  "toolsAndDomainKnowledge",
  "userOrCustomerImpact",
];

const guidedMaterialSections: Array<{
  key: keyof GuidedMaterialFields;
  label: string;
}> = [
  { key: "projectOrInitiativeTitle", label: "Project / initiative" },
  { key: "companyOrContext", label: "Company / context" },
  { key: "roleAndTimeframe", label: "Role and timeframe" },
  { key: "problem", label: "Problem" },
  { key: "ownership", label: "My ownership" },
  { key: "actions", label: "Actions" },
  { key: "metricsBefore", label: "Metrics before" },
  { key: "metricsAfter", label: "Metrics after" },
  { key: "businessImpact", label: "Business impact" },
  { key: "userOrCustomerImpact", label: "User / customer impact" },
  { key: "toolsAndDomainKnowledge", label: "Tools / domain knowledge" },
  { key: "difficultyOrTradeoff", label: "Difficulty / tradeoff" },
  { key: "publicSafeWording", label: "Public-safe wording" },
  { key: "confidentialDetailsToAvoid", label: "Confidential details to avoid" },
];

export function buildGuidedMaterialMarkdown(
  fields: GuidedMaterialFields,
  target?: GuidedMaterialTarget | null,
) {
  const title =
    fields.projectOrInitiativeTitle.trim() ||
    target?.targetTitle?.trim() ||
    "Guided project material";
  const lines = [`# ${title}`];
  if (target?.targetType) {
    lines.push("", `Target story type: ${formatTargetType(target.targetType)}`);
  }
  if (target?.missingFields?.length) {
    lines.push("", `Missing fields to strengthen: ${target.missingFields.join(", ")}`);
  }
  for (const section of guidedMaterialSections) {
    const value = fields[section.key].trim();
    lines.push("", `## ${section.label}`, value || "_Not provided yet._");
  }
  return lines.join("\n");
}

export function getGuidedMaterialReadiness(fields: GuidedMaterialFields) {
  const answeredFields = substantiveGuidedFields.filter(
    (field) => isSubstantiveAnswer(fields[field]),
  );
  const hasTitle = isSubstantiveAnswer(fields.projectOrInitiativeTitle);
  return {
    answeredCount: answeredFields.length,
    isReady: hasTitle && answeredFields.length >= 3,
    missingReason: !hasTitle
      ? "Add a project or initiative title."
      : answeredFields.length < 3
        ? "Answer at least 3 substantive guided fields before enrichment."
        : null,
  };
}

export function hasGuidedMaterialContent(markdown: string) {
  const contentLines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("#") &&
        line !== "_Not provided yet._" &&
        !line.startsWith("Target story type:") &&
        !line.startsWith("Missing fields to strengthen:"),
    );
  return contentLines.join(" ").length >= 80;
}

function formatTargetType(type: NonNullable<GuidedMaterialTarget["targetType"]>) {
  return type.replace(/_/g, " ");
}

function isSubstantiveAnswer(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length >= 8 && normalized !== "_Not provided yet._";
}
