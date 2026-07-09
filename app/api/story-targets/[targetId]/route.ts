import { NextResponse } from "next/server";
import { z } from "zod";

import { schedulePersonalEmbeddingsSync } from "../../../../src/server/embedding-service";
import { applyStoryTargetCorrection } from "../../../../src/server/story-target-correction";

const paramsSchema = z.object({
  targetId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("mark_reviewed"),
    targetType: z.enum(["initiative", "portfolio_project"]),
  }),
  z.object({
    action: z.literal("mark_needs_update"),
    targetType: z.enum(["initiative", "portfolio_project"]),
  }),
  z.object({
    action: z.literal("reject_story"),
    targetType: z.enum(["initiative", "portfolio_project"]),
  }),
  z.object({
    action: z.literal("assign_work_experience"),
    targetType: z.literal("initiative"),
    workExperienceId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("convert_to_initiative"),
    targetType: z.literal("portfolio_project"),
    workExperienceId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("convert_to_portfolio_project"),
    targetType: z.literal("initiative"),
    projectType: z.enum([
      "personal_project",
      "academic_project",
      "open_source",
      "freelance",
      "hackathon",
      "general_project",
    ]).optional(),
  }),
  z.object({
    action: z.literal("create_work_experience_and_assign"),
    targetType: z.literal("initiative"),
    employer: z.string().trim().min(1).max(240),
    roleTitle: z.string().trim().min(1).max(240),
    team: z.string().trim().max(240).nullable().optional(),
    location: z.string().trim().max(240).nullable().optional(),
    startDate: z.string().trim().max(80).nullable().optional(),
    endDate: z.string().trim().max(80).nullable().optional(),
    summary: z.string().trim().max(1000).nullable().optional(),
  }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ targetId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid story target update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await applyStoryTargetCorrection({
    action: body.data.action,
    targetId: params.data.targetId,
    targetType: body.data.targetType,
    payload: buildStoryTargetCorrectionPayload(body.data),
  });

  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Story target not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_story_target_update" },
      { status: 409 },
    );
  }

  schedulePersonalEmbeddingsSync(`story_target_${body.data.action}`);
  return NextResponse.json({ data: result });
}

function buildStoryTargetCorrectionPayload(body: z.infer<typeof requestSchema>) {
  switch (body.action) {
    case "assign_work_experience":
      return { workExperienceId: body.workExperienceId };
    case "convert_to_initiative":
      return { workExperienceId: body.workExperienceId };
    case "convert_to_portfolio_project":
      return { projectType: body.projectType };
    case "create_work_experience_and_assign":
      return {
        employer: body.employer,
        roleTitle: body.roleTitle,
        team: body.team,
        location: body.location,
        startDate: body.startDate,
        endDate: body.endDate,
        summary: body.summary,
      };
    case "mark_reviewed":
    case "mark_needs_update":
    case "reject_story":
      return undefined;
  }
}
