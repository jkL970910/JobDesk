import { NextResponse } from "next/server";

import { getRecentJdAnalyses } from "../../../../src/server/job-repository";

export async function GET() {
  try {
    const jobs = await getRecentJdAnalyses(5);
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
