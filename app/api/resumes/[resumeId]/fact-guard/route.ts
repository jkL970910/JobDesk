import { NextResponse } from "next/server";
import { z } from "zod";

import { runFactGuardForResume } from "../../../../../src/server/resume-repository";

const paramsSchema = z.object({
  resumeId: z.string().uuid(),
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ resumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid Fact Guard request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await runFactGuardForResume(params.data.resumeId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Resume not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: result });
}
