import { NextResponse } from "next/server";

import { getEnrichmentTaskQueue } from "../../../src/server/enrichment-task-repository";

export async function GET() {
  try {
    const result = await getEnrichmentTaskQueue();
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
