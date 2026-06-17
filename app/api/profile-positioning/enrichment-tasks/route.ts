import { NextResponse } from "next/server";
import { z } from "zod";

import { createPositioningEnrichmentTasks } from "../../../../src/server/profile-positioning-repository";

const CreatePositioningEnrichmentTasksRequest = z.object({
  positioningReportId: z.string().uuid(),
  positioningDirectionId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const parsed = CreatePositioningEnrichmentTasksRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid positioning enrichment task request.",
        issues: parsed.error.issues,
        kind: "validation_error",
      },
      { status: 400 },
    );
  }

  const result = await createPositioningEnrichmentTasks({
    reportId: parsed.data.positioningReportId,
    directionId: parsed.data.positioningDirectionId,
  });
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Positioning direction not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: result });
}
