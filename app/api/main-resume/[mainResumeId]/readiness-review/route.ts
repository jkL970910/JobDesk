import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getLatestGeneratedMainResumeReadinessReview,
  reviewGeneratedMainResumeReadiness,
} from "../../../../../src/server/generated-resume-readiness-review";

const paramsSchema = z.object({
  mainResumeId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ mainResumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid generated resume review request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const review = await getLatestGeneratedMainResumeReadinessReview(
    params.data.mainResumeId,
  );
  return NextResponse.json({ data: { review } });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ mainResumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid generated resume review request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await reviewGeneratedMainResumeReadiness(params.data.mainResumeId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Main resume not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: result });
}
