import { NextResponse } from "next/server";

import { runProfileEvidenceExtractionWorkerForRun } from "../../../../../../../src/server/profile-evidence-extraction-worker";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const result = await runProfileEvidenceExtractionWorkerForRun(runId);
  if (result.status === "skipped") {
    return NextResponse.json(
      { error: "Database is not configured.", kind: result.reason },
      { status: 503 },
    );
  }
  if (result.status === "not_claimable") {
    return NextResponse.json(
      { error: "Extraction run is already processing, completed, failed, or unavailable.", kind: result.status },
      { status: 409 },
    );
  }
  return NextResponse.json({ data: result });
}
