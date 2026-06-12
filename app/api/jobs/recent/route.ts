import { NextResponse } from "next/server";
import { z } from "zod";

import { getRecentJdAnalyses } from "../../../../src/server/job-repository";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const jobs = await getRecentJdAnalyses(query.limit);
    return NextResponse.json({
      data: jobs,
      meta: {
        persistence: jobs.length > 0 ? "available" : "empty-or-unconfigured",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load recent jobs.",
        kind: "database_error",
      },
      { status: 500 },
    );
  }
}
