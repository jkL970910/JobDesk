import type { TailoredResumeDraft } from "../schemas/tailored-resume";

export class TailoredResumeGuardrailError extends Error {
  readonly kind = "tailored_resume_guardrail_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "TailoredResumeGuardrailError";
  }
}

export function validateTailoredResumeDraft(args: {
  draft: TailoredResumeDraft;
  eligibleEvidence: Array<{
    id: string;
    source_quote: string;
    text: string;
    public_safe_summary?: string | null;
  }>;
}) {
  const eligible = new Map(
    args.eligibleEvidence.map((item) => [item.id, item]),
  );
  if (args.draft.claims.length === 0) {
    throw new TailoredResumeGuardrailError(
      "Tailored resume must include at least one generated claim.",
    );
  }
  for (const [index, claim] of args.draft.claims.entries()) {
    if (claim.evidence_ids.length === 0) {
      throw new TailoredResumeGuardrailError(
        `Generated claim ${index + 1} has no evidence mapping.`,
      );
    }
    if (claim.source_quotes.length === 0) {
      throw new TailoredResumeGuardrailError(
        `Generated claim ${index + 1} has no source quote.`,
      );
    }
    const leakedId = claim.evidence_ids.find((id) => !eligible.has(id));
    if (leakedId) {
      throw new TailoredResumeGuardrailError(
        `Generated claim ${index + 1} referenced ineligible evidence ${leakedId}.`,
      );
    }
    if (claim.primary_evidence_id && claim.evidence_ids[0] !== claim.primary_evidence_id) {
      throw new TailoredResumeGuardrailError(
        `Generated claim ${index + 1} does not list its primary evidence first.`,
      );
    }
    const primaryEvidence = eligible.get(claim.evidence_ids[0]!);
    const hasPrimaryQuote = claim.source_quotes.some(
      (quote) =>
        primaryEvidence &&
        (primaryEvidence.source_quote.includes(quote) ||
          primaryEvidence.text.includes(quote) ||
          (primaryEvidence.public_safe_summary?.includes(quote) ?? false) ||
          quote.includes(primaryEvidence.source_quote)),
    );
    if (!hasPrimaryQuote) {
      throw new TailoredResumeGuardrailError(
        `Generated claim ${index + 1} has no source quote from its primary evidence.`,
      );
    }
    const quotedEvidence = claim.evidence_ids.map((id) => eligible.get(id));
    const unsupportedQuote = claim.source_quotes.find(
      (quote) =>
        !quotedEvidence.some(
          (item) =>
            item &&
            (item.source_quote.includes(quote) ||
              item.text.includes(quote) ||
              (item.public_safe_summary?.includes(quote) ?? false) ||
              quote.includes(item.source_quote)),
        ),
    );
    if (unsupportedQuote) {
      throw new TailoredResumeGuardrailError(
        `Generated claim ${index + 1} used a quote that is not supported by its evidence.`,
      );
    }
  }
  const coverage = validateBulletClaimCoverage({
    resumeMarkdown: args.draft.resume_markdown,
    claims: args.draft.claims.map((claim) => claim.claim_text),
  });
  if (!coverage.passed) {
    throw new TailoredResumeGuardrailError(coverage.reason);
  }
}

export function validateBulletClaimCoverage(args: {
  resumeMarkdown: string;
  claims: string[];
}) {
  const bullets = extractResumeBullets(args.resumeMarkdown);
  const normalizedClaims = args.claims
    .map(normalizeClaimText)
    .filter((claim) => claim.length >= 8);
  const unmappedBullet = bullets.find(
    (bullet) => !normalizedClaims.some((claim) => claimsMatch(bullet, claim)),
  );
  if (unmappedBullet) {
    return {
      passed: false as const,
      reason: `resume bullet is not mapped to a generated claim: ${unmappedBullet.slice(0, 120)}`,
    };
  }

  return { passed: true as const, reason: null };
}

export function extractResumeBullets(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+[.)]\s+/, ""),
    )
    .filter((line, index, lines) => {
      const original = markdown.split(/\r?\n/)[index]?.trim() ?? "";
      return /^([-*]\s+|\d+[.)]\s+)/.test(original) && line.length >= 8;
    })
    .map(normalizeClaimText)
    .filter(Boolean);
}

export function claimsMatch(left: string, right: string) {
  if (left === right || left.includes(right) || right.includes(left)) {
    return true;
  }

  const leftTokens = toSignificantTokens(left);
  const rightTokens = toSignificantTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;
  const smallerSize = Math.min(leftSet.size, rightSet.size);
  const largerSize = Math.max(leftSet.size, rightSet.size);
  return overlap / smallerSize >= 0.6 && overlap / largerSize >= 0.35;
}

function toSignificantTokens(text: string) {
  const stopwords = new Set([
    "a",
    "an",
    "and",
    "for",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
  ]);
  return normalizeClaimText(text)
    .split(/[^a-z0-9%]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

function normalizeClaimText(text: string) {
  return text
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/[“”"']/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
