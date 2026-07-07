import { NextResponse } from "next/server";
import { z } from "zod";

import { schedulePersonalEmbeddingsSync } from "../../../../../src/server/embedding-service";
import { quarantineEvidenceAsset } from "../../../../../src/server/evidence-asset-actions";

const paramsSchema = z.object({
  evidenceId: z.string().uuid(),
});

const requestSchema = z.object({
  confirmation: z.string(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ evidenceId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid evidence quarantine request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await quarantineEvidenceAsset({
    evidenceId: params.data.evidenceId,
    confirmation: body.data.confirmation,
    reason: body.data.reason,
  });
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Evidence item not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      {
        error: result.reason,
        kind: "invalid_evidence_quarantine",
      },
      { status: 409 },
    );
  }

  schedulePersonalEmbeddingsSync("evidence_quarantine");
  return NextResponse.json({ data: result });
}
