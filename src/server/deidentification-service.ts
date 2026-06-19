const blockedTermPatterns = [
  /\bconfidential\b/gi,
  /\binternal[-\s]?only\b/gi,
  /\bclient\s+[A-Z][A-Za-z0-9&.-]+\b/g,
  /\bcustomer\s+[A-Z][A-Za-z0-9&.-]+\b/g,
  /\bproject\s+[A-Z][A-Za-z0-9&.-]+\b/g,
  /\b[A-Z][A-Za-z0-9&.-]+\s+(?:Bank|Finance|Capital|Labs|Corp|Inc|LLC)\b/g,
];

export type RedactionReport = {
  hasBlockedTerms: boolean;
  blockedTerms: string[];
  suggestedSummary: string;
  diff: Array<{
    from: string;
    to: string;
  }>;
};

export function buildRedactionReport(input: {
  text: string;
  fallbackSummary?: string | null;
}): RedactionReport {
  const source = input.fallbackSummary?.trim() || input.text;
  const blockedTerms = findBlockedTerms(source);
  let suggestedSummary = source;
  const diff: RedactionReport["diff"] = [];

  for (const term of blockedTerms) {
    const replacement = replacementForTerm(term);
    suggestedSummary = replaceAllCaseInsensitive(suggestedSummary, term, replacement);
    diff.push({ from: term, to: replacement });
  }

  return {
    hasBlockedTerms: blockedTerms.length > 0,
    blockedTerms,
    suggestedSummary: suggestedSummary.trim(),
    diff,
  };
}

export function isPublicSafeText(text: string) {
  return findBlockedTerms(text).length === 0;
}

export function hasResumeSafeDisclosure(input: {
  text?: string | null;
  sensitivityLevel?: string | null;
  publicSafeSummary?: string | null;
}) {
  if (input.sensitivityLevel === "public_safe") {
    return isPublicSafeText(input.publicSafeSummary?.trim() || input.text || "");
  }
  const summary = input.publicSafeSummary?.trim();
  return Boolean(summary && isPublicSafeText(summary));
}

function findBlockedTerms(text: string) {
  const seen = new Set<string>();
  for (const pattern of blockedTermPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (value) seen.add(value);
    }
  }
  return [...seen];
}

export function findPublicUnsafeTerms(text: string) {
  return findBlockedTerms(text);
}

function replacementForTerm(term: string) {
  if (/client/i.test(term)) return "client";
  if (/customer/i.test(term)) return "customer";
  if (/project/i.test(term)) return "internal project";
  if (/confidential|internal/i.test(term)) return "private";
  if (/bank|finance|capital/i.test(term)) return "financial services company";
  return "company";
}

function replaceAllCaseInsensitive(text: string, from: string, to: string) {
  return text.replace(new RegExp(escapeRegExp(from), "gi"), to);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
