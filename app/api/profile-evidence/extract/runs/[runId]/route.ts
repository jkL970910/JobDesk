import { NextResponse } from "next/server";

import { getProfileEvidenceExtractionRun } from "../../../../../../src/server/profile-evidence-extraction-run-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const result = await getProfileEvidenceExtractionRun(runId);
  if (result.status === "skipped") {
    return NextResponse.json(
      { error: "Database is not configured.", kind: result.reason },
      { status: 503 },
    );
  }
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Extraction run not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { run: result.run } });
}
