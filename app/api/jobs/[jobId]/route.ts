import { NextResponse } from "next/server";
import { z } from "zod";

import {
  archiveJdAnalysis,
  getJdAnalysisById,
} from "../../../../src/server/job-repository";

const paramsSchema = z.object({
  jobId: z.string().uuid(),
});

const patchSchema = z.object({
  action: z.literal("archive"),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid job id.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const job = await getJdAnalysisById(params.data.jobId);
  if (!job) {
    return NextResponse.json(
      { error: "Job not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: job });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid job update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await archiveJdAnalysis(params.data.jobId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Job not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: result });
}
