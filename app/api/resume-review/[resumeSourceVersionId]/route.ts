import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteResumeSourceVersion,
  getResumeSourceDeleteImpact,
  getResumeSourceVersion,
  startResumeReviewRun,
} from "../../../../src/server/resume-review-repository";

const patchSchema = z.object({
  action: z.literal("rerun_review"),
});
const deleteSchema = z.object({
  cleanupMode: z.enum(["keep_library", "remove_draft_materials"]).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ resumeSourceVersionId: string }> },
) {
  const { resumeSourceVersionId } = await context.params;
  const includeDeleteImpact = new URL(request.url).searchParams.get("includeDeleteImpact") === "1";
  if (includeDeleteImpact) {
    const result = await getResumeSourceDeleteImpact(resumeSourceVersionId);
    if (result.status === "not_found") {
      return NextResponse.json(
        { error: "Resume source version not found.", kind: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ data: result });
  }
  const result = await getResumeSourceVersion(resumeSourceVersionId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Resume source version not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: result });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ resumeSourceVersionId: string }> },
) {
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid resume review update request.", kind: "invalid_request" },
      { status: 400 },
    );
  }
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resumeSourceVersionId: string }> },
) {
  const { resumeSourceVersionId } = await context.params;
  const body = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid resume delete request.", kind: "invalid_request" },
      { status: 400 },
    );
  }
  const result = await deleteResumeSourceVersion(resumeSourceVersionId, {
    cleanupMode: body.data.cleanupMode,
  });
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Resume source version not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: result });
}
