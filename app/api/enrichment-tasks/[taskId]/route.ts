import { NextResponse } from "next/server";
import { z } from "zod";

import { updateEnrichmentTask } from "../../../../src/server/enrichment-task-repository";

const paramsSchema = z.object({
  taskId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("answer"),
    userAnswer: z.string().trim().min(1).max(4000),
  }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("convert") }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid enrichment task update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await updateEnrichmentTask({
    taskId: params.data.taskId,
    ...body.data,
  });
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Enrichment task not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_enrichment_task_update" },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: result });
}
