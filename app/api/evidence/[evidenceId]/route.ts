import { NextResponse } from "next/server";
import { z } from "zod";

import { updateEvidenceItem } from "../../../../src/server/profile-evidence-repository";
import { AllowedUsage, SensitivityLevel } from "../../../../src/schemas/shared";

const paramsSchema = z.object({
  evidenceId: z.string().uuid(),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("approve_for_resume"),
    allowedUsage: z.array(AllowedUsage).optional(),
  }),
  z.object({ action: z.literal("reject") }),
  z.object({
    action: z.literal("edit"),
    text: z.string().trim().min(1).max(2000).optional(),
    publicSafeSummary: z.string().trim().max(2000).nullable().optional(),
    allowedUsage: z.array(AllowedUsage).optional(),
    sensitivityLevel: SensitivityLevel.optional(),
    relatedProjectId: z.string().uuid().nullable().optional(),
  }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ evidenceId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid evidence update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await updateEvidenceItem({
    evidenceId: params.data.evidenceId,
    ...body.data,
  });
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Evidence item not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_evidence_update" },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: result });
}
