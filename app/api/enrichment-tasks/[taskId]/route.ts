import { NextResponse } from "next/server";
import { z } from "zod";

import { updateEnrichmentTask } from "../../../../src/server/enrichment-task-repository";
import { schedulePersonalEmbeddingsSync } from "../../../../src/server/embedding-service";

const paramsSchema = z.object({
  taskId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("answer"),
    userAnswer: z.string().trim().min(1).max(4000),
  }),
  z.object({ action: z.literal("acknowledge") }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("convert") }),
  z.object({
    action: z.literal("accept_proposal"),
    proposalId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("reject_proposal"),
    proposalId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("revise_proposal"),
    proposalId: z.string().uuid(),
    revisedText: z.string().trim().min(12).max(4000).optional(),
    revisionInstruction: z.string().trim().min(3).max(1200).optional(),
  }),
  z.object({
    action: z.literal("link"),
    anchor: z.object({
      evidenceItemId: z.string().uuid().nullable().optional(),
      initiativeId: z.string().uuid().nullable().optional(),
      portfolioProjectId: z.string().uuid().nullable().optional(),
      workExperienceId: z.string().uuid().nullable().optional(),
    }),
  }),
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
  if (
    body.data.action === "revise_proposal" &&
    !body.data.revisedText &&
    !body.data.revisionInstruction
  ) {
    return NextResponse.json(
      { error: "Provide revised text or revision instructions.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await updateEnrichmentTask({
    taskId: params.data.taskId,
    ...body.data,
    useAiExtraction: body.data.action === "convert",
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

  if (body.data.action === "convert" || body.data.action === "accept_proposal") {
    schedulePersonalEmbeddingsSync("enrichment_task_commit");
  }
  return NextResponse.json({ data: result });
}
