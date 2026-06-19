import { NextResponse } from "next/server";
import { z } from "zod";

import {
  approveProjectEvidenceForResume,
  updateProjectCard,
} from "../../../../src/server/profile-evidence-repository";
import { SensitivityLevel } from "../../../../src/schemas/shared";
import { schedulePersonalEmbeddingsSync } from "../../../../src/server/embedding-service";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("approve_project_evidence_for_resume") }),
  z.object({ action: z.literal("reject") }),
  z.object({
    action: z.literal("edit"),
    title: z.string().trim().min(1).max(240).optional(),
    context: z.string().trim().max(4000).nullable().optional(),
    problem: z.string().trim().max(4000).nullable().optional(),
    role: z.string().trim().max(1000).nullable().optional(),
    publicSafeSummary: z.string().trim().max(4000).nullable().optional(),
    sensitivityLevel: SensitivityLevel.optional(),
  }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid project update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  if (body.data.action === "approve_project_evidence_for_resume") {
    const result = await approveProjectEvidenceForResume(params.data.projectId);
    schedulePersonalEmbeddingsSync("project_approve_evidence_for_resume");
    return NextResponse.json({ data: result });
  }

  const result = await updateProjectCard({
    projectId: params.data.projectId,
    ...body.data,
  });
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Project card not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      {
        error: result.reason,
        kind: "invalid_project_update",
        redactionReport: result.redactionReport,
      },
      { status: 409 },
    );
  }

  schedulePersonalEmbeddingsSync(`project_${body.data.action}`);
  return NextResponse.json({ data: result });
}
