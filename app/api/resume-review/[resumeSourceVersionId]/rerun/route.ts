import { NextResponse } from "next/server";

import { startResumeReviewRun } from "../../../../../src/server/resume-review-repository";

export async function POST(
  _request: Request,
  context: { params: Promise<{ resumeSourceVersionId: string }> },
) {
  const { resumeSourceVersionId } = await context.params;
  const result = await startResumeReviewRun(resumeSourceVersionId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Resume source version not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: result });
}
