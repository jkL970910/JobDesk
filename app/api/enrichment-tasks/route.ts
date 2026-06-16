import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getEnrichmentTaskQueue,
  type EnrichmentTaskQueueFilters,
  type EnrichmentTaskSourceType,
  type EnrichmentTaskStatus,
} from "../../../src/server/enrichment-task-repository";

const allowedSourceTypes = new Set<EnrichmentTaskSourceType>([
  "evidence",
  "extraction_note",
  "jd_gap",
  "resume_review",
  "story_target",
  "user_input",
]);

const allowedStatuses = new Set<EnrichmentTaskStatus>([
  "answered",
  "converted",
  "dismissed",
  "open",
]);

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const sourceType = params.get("sourceType");
    const statuses = params
      .getAll("status")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter((value): value is EnrichmentTaskStatus =>
        allowedStatuses.has(value as EnrichmentTaskStatus),
      );
    const filters: EnrichmentTaskQueueFilters = {
      limit: Number(params.get("limit") ?? 50),
      resumeReviewReportId: params.get("resumeReviewReportId") ?? undefined,
      resumeSourceVersionId: params.get("resumeSourceVersionId") ?? undefined,
      sourceType:
        sourceType && allowedSourceTypes.has(sourceType as EnrichmentTaskSourceType)
          ? (sourceType as EnrichmentTaskSourceType)
          : undefined,
      statuses: statuses.length ? statuses : undefined,
    };
    const result = await getEnrichmentTaskQueue(filters);
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load enrichment tasks.",
        kind: "database_error",
      },
      { status: 500 },
    );
  }
}
