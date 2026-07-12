import { NextResponse } from "next/server";
import { z } from "zod";

import { applyCandidateReviewAction } from "../../../../src/server/scope-review-candidate";

const paramsSchema = z.object({
  candidateId: z.string().min(3).max(96),
});

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("save_as_unassigned") }),
  z.object({
    action: z.literal("save_as_profile_context"),
    profileContextText: z.string().trim().min(2).max(4000).optional(),
  }),
  z.object({
    action: z.literal("save_as_evidence"),
    evidenceText: z.string().trim().min(2).max(4000).optional(),
    sourceQuote: z.string().trim().min(2).max(4000).optional(),
  }),
  z.object({
    action: z.literal("save_as_work_initiative"),
    title: z.string().trim().min(2).max(240).optional(),
    workExperienceId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("save_as_portfolio_project"),
    title: z.string().trim().min(2).max(240).optional(),
    projectType: z.enum([
      "personal_project",
      "academic_project",
      "open_source",
      "freelance",
      "hackathon",
      "general_project",
    ]).optional(),
  }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json(
      { error: "Invalid candidate review request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await applyCandidateReviewAction({
    action: body.data.action,
    candidateId: params.data.candidateId,
    payload: buildCandidateReviewPayload(body.data),
  });

  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Review candidate not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_candidate_review_action" },
      { status: 409 },
    );
  }
  return NextResponse.json({ data: result });
}

function buildCandidateReviewPayload(body: z.infer<typeof requestSchema>) {
  switch (body.action) {
    case "save_as_profile_context":
      return { profileContextText: body.profileContextText };
    case "save_as_evidence":
      return { evidenceText: body.evidenceText, sourceQuote: body.sourceQuote };
    case "save_as_work_initiative":
      return { title: body.title, workExperienceId: body.workExperienceId };
    case "save_as_portfolio_project":
      return { title: body.title, projectType: body.projectType };
    case "dismiss":
    case "save_as_unassigned":
      return undefined;
  }
}
