import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createProfileEvidenceExtractionRun,
} from "../../../../../src/server/profile-evidence-extraction-run-repository";

const requestSchema = z.object({
  replacement: z.object({
    originalRunId: z.string().uuid().nullable().optional(),
    sourceDocumentId: z.string().uuid().nullable().optional(),
    segmentId: z.string().trim().min(1).max(120),
    segmentText: z.string().trim().min(40).max(50_000),
    segmentTextHash: z.string().trim().min(1).max(128),
    segmentTitle: z.string().trim().min(1).max(240),
  }).optional(),
  sourceText: z.string().trim().min(80).max(50_000),
  sourceTitle: z.string().trim().min(1).max(240).optional(),
  sourceDocumentId: z.string().uuid().optional(),
  sourceType: z.enum(["profile-evidence", "jd-gap-note", "project-note"]).optional(),
  resumeSourceVersionId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid extraction run request.", kind: "invalid_request" },
      { status: 400 },
    );
  }
  const result = await createProfileEvidenceExtractionRun(parsed.data);
  if (result.status === "skipped") {
    return NextResponse.json(
      { error: "Database is not configured.", kind: result.reason },
      { status: 503 },
    );
  }
  if (result.status !== "created") {
    return NextResponse.json(
      { error: "Could not create extraction run.", kind: "run_create_failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ data: { run: result.run } }, { status: 202 });
}
