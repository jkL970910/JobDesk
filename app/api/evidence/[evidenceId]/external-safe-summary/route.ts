import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { JobDeskAiError } from "../../../../../src/ai/errors";
import { suggestExternalSafeSummaryWithAi } from "../../../../../src/ai/external-safe-summary";
import { getDb, hasDatabaseUrl } from "../../../../../src/db/client";
import { evidenceItems } from "../../../../../src/db/schema";
import {
  buildRedactionReport,
  findPublicUnsafeTerms,
  isPublicSafeText,
} from "../../../../../src/server/deidentification-service";
import { getCurrentWorkspace } from "../../../../../src/server/workspace-repository";

const paramsSchema = z.object({
  evidenceId: z.string().uuid(),
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ evidenceId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid evidence id.", kind: "invalid_request" },
      { status: 400 },
    );
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database is not configured.", kind: "missing_database_url" },
      { status: 503 },
    );
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [item] = await db
    .select({
      id: evidenceItems.id,
      text: evidenceItems.text,
      sourceQuote: evidenceItems.sourceQuote,
      publicSafeSummary: evidenceItems.publicSafeSummary,
      sensitivityLevel: evidenceItems.sensitivityLevel,
    })
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, workspace.id),
        eq(evidenceItems.id, params.data.evidenceId),
      ),
    )
    .limit(1);

  if (!item) {
    return NextResponse.json(
      { error: "Evidence item not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  const sourceText = `${item.text}\n${item.sourceQuote}`.trim();
  const blockedTerms = findPublicUnsafeTerms(sourceText);
  const deterministic = buildRedactionReport({
    text: sourceText,
    fallbackSummary: item.publicSafeSummary,
  });

  try {
    const aiSuggestion = await suggestExternalSafeSummaryWithAi({
      evidenceText: item.text,
      sourceQuote: item.sourceQuote,
      sensitivityLevel: item.sensitivityLevel,
      blockedTerms,
    });
    const summary = aiSuggestion.data.safe_summary.trim();
    if (summary && isPublicSafeText(summary)) {
      return NextResponse.json({
        data: {
          provider: "ai",
          safeSummary: summary,
          confidence: aiSuggestion.data.confidence,
          needsUserReview: true,
          blockedTerms,
          redactionReport: {
            hasBlockedTerms: deterministic.hasBlockedTerms,
            blockedTerms: deterministic.blockedTerms,
            diff: aiSuggestion.data.removed_or_generalized_terms.map((entry) => ({
              from: entry.original_span,
              to: entry.replacement,
              reason: entry.reason,
            })),
            suggestedSummary: summary,
          },
        },
      });
    }
  } catch (error) {
    if (!(error instanceof JobDeskAiError)) {
      console.error("External-safe summary suggestion failed", error);
    }
  }

  return NextResponse.json({
    data: {
      provider: "deterministic",
      safeSummary: deterministic.suggestedSummary,
      confidence: "low",
      needsUserReview: true,
      blockedTerms,
      redactionReport: deterministic,
    },
  });
}
