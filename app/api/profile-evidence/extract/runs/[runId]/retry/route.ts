import { NextResponse } from "next/server";

import { retryProfileEvidenceExtractionRun } from "../../../../../../../src/server/profile-evidence-extraction-run-repository";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const result = await retryProfileEvidenceExtractionRun(runId);
  if (result.status === "skipped") {
    return NextResponse.json(
      { error: "Database is not configured.", kind: result.reason },
      { status: 503 },
    );
  }
  if (result.status !== "queued") {
    return NextResponse.json(
      { error: "Extraction run is not retryable.", kind: result.status },
      { status: 409 },
    );
  }
  return NextResponse.json({ data: { run: result.run } }, { status: 202 });
}
