import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getLatestGeneratedTailoredResumeReadinessReview,
  reviewGeneratedTailoredResumeReadiness,
} from "../../../../../src/server/generated-resume-readiness-review";

const paramsSchema = z.object({
  resumeId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ resumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid generated resume review request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const review = await getLatestGeneratedTailoredResumeReadinessReview(params.data.resumeId);
  return NextResponse.json({ data: { review } });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ resumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid generated resume review request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await reviewGeneratedTailoredResumeReadiness(params.data.resumeId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Resume not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: result });
}
