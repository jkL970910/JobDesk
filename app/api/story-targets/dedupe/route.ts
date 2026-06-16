import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getStoryDedupeCandidates,
  keepStoryOverlapSeparate,
} from "../../../../src/server/profile-evidence-repository";

const storyTypeSchema = z.enum(["initiative", "portfolio_project"]);

const decisionSchema = z.object({
  action: z.literal("keep_separate"),
  storyType: storyTypeSchema,
  primaryStoryId: z.string().uuid(),
  duplicateStoryId: z.string().uuid().optional(),
  duplicateStoryIds: z.array(z.string().uuid()).optional(),
});

export async function GET() {
  const result = await getStoryDedupeCandidates(8);
  return NextResponse.json({ data: result });
}

export async function POST(request: Request) {
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid story overlap request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await keepStoryOverlapSeparate(parsed.data);
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_overlap_decision" },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: result });
}
