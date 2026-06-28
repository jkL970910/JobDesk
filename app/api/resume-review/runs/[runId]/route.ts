import { NextResponse } from "next/server";

import { getResumeReviewRun } from "../../../../../src/server/resume-review-repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const result = await getResumeReviewRun(runId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Resume review run not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: result });
}
