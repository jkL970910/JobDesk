import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveSectionRetryPayloadForTask } from "../../../../../src/server/enrichment-task-repository";

const paramsSchema = z.object({
  taskId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid enrichment task request.", kind: "invalid_request" },
      { status: 400 },
    );
  }
  const result = await resolveSectionRetryPayloadForTask(params.data.taskId);
  if (result.status === "skipped") {
    return NextResponse.json(
      { error: "Database is not configured.", kind: result.reason },
      { status: 503 },
    );
  }
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Enrichment task not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "not_retryable") {
    return NextResponse.json(
      { error: "This review item does not have a retryable source section.", kind: "not_retryable" },
      { status: 409 },
    );
  }
  return NextResponse.json({ data: { payload: result.payload } });
}
