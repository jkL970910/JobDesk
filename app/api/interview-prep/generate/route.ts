import { NextResponse } from "next/server";
import { z } from "zod";

import { generateInterviewPrepPack } from "../../../../src/server/interview-prep-service";

const requestSchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid interview prep request.", kind: "invalid_request" },
      { status: 400 },
    );
  }
  const result = await generateInterviewPrepPack(parsed.data.jobId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Job not found or archived.", kind: "job_not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: result });
}
