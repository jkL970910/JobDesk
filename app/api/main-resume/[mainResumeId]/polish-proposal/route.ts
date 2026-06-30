import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyMainResumePolishProposal,
  getMainResumePolishProposal,
  reviewGeneratedMainResumeReadiness,
} from "../../../../../src/server/generated-resume-readiness-review";
import { runFactGuardForMainResume } from "../../../../../src/server/resume-repository";

const paramsSchema = z.object({
  mainResumeId: z.string().uuid(),
});

const applyBodySchema = z
  .object({
    editable_sections: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          label: z.string().trim().min(1),
          original_text: z.string().default(""),
          proposed_text: z.string().trim().min(1),
          target_heading: z.string().trim().min(1),
        }),
      )
      .optional(),
  })
  .default({});

export async function GET(
  _request: Request,
  context: { params: Promise<{ mainResumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid generated resume polish request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await getMainResumePolishProposal(params.data.mainResumeId);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Main resume not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "review_required") {
    return NextResponse.json(
      {
        error: "Review generated resume before building a polish proposal.",
        kind: "readiness_review_required",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: result });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ mainResumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid generated resume polish request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const body = applyBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid generated resume polish proposal.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const applied = await applyMainResumePolishProposal(params.data.mainResumeId, {
    editableSections: body.data.editable_sections,
  });
  if (applied.status === "not_found") {
    return NextResponse.json(
      { error: "Main resume not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (applied.status === "review_required") {
    return NextResponse.json(
      {
        error: "Review generated resume before applying a polish proposal.",
        kind: "readiness_review_required",
      },
      { status: 409 },
    );
  }
  if (applied.status !== "applied") {
    return NextResponse.json({ data: applied });
  }

  const factGuard = await runFactGuardForMainResume(applied.mainResumeVersionId);
  const readiness = await reviewGeneratedMainResumeReadiness(applied.mainResumeVersionId);
  return NextResponse.json({
    data: {
      ...applied,
      factGuard,
      readiness,
    },
  });
}
