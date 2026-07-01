import { NextResponse } from "next/server";
import { z } from "zod";

import { schedulePersonalEmbeddingsSync } from "../../../../src/server/embedding-service";
import {
  reviewWorkExperience,
  updateWorkExperienceFields,
} from "../../../../src/server/profile-evidence-repository";

const paramsSchema = z.object({
  experienceId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_fields"),
    endDate: z.string().trim().max(80).nullable().optional(),
    location: z.string().trim().max(240).nullable().optional(),
    startDate: z.string().trim().max(80).nullable().optional(),
    summary: z.string().trim().max(1000).nullable().optional(),
    taskId: z.string().uuid().nullable().optional(),
    team: z.string().trim().max(240).nullable().optional(),
  }),
  z.object({
    action: z.enum(["mark_reviewed", "mark_needs_update", "reject_role"]),
    downstreamStrategy: z.enum(["keep", "delete_downstream", "reassign"]).optional(),
    reassignToWorkExperienceId: z.string().uuid().nullable().optional(),
  }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ experienceId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid work experience update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = body.data.action === "update_fields"
    ? await updateWorkExperienceFields({
        workExperienceId: params.data.experienceId,
        endDate: body.data.endDate,
        location: body.data.location,
        startDate: body.data.startDate,
        summary: body.data.summary,
        taskId: body.data.taskId,
        team: body.data.team,
      })
    : await reviewWorkExperience({
        workExperienceId: params.data.experienceId,
        action: body.data.action,
        downstreamStrategy: body.data.downstreamStrategy,
        reassignToWorkExperienceId: body.data.reassignToWorkExperienceId,
      });

  if (result.status === "skipped") {
    return NextResponse.json(
      { error: "Storage is not configured.", kind: result.reason },
      { status: 503 },
    );
  }
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Work experience not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_work_experience_update" },
      { status: 409 },
    );
  }

  schedulePersonalEmbeddingsSync(
    body.data.action === "update_fields" ? "work_experience_field_update" : "work_experience_review",
  );
  return NextResponse.json({ data: result });
}
