import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getStoryDedupeCandidates,
  keepStoryOverlapSeparate,
  mergeStoryTargets,
} from "../../../../src/server/profile-evidence-repository";
import { schedulePersonalEmbeddingsSync } from "../../../../src/server/embedding-service";

const storyTypeSchema = z.enum(["initiative", "portfolio_project"]);

const keepSeparateDecisionSchema = z.object({
  action: z.literal("keep_separate"),
  storyType: storyTypeSchema,
  primaryStoryId: z.string().uuid(),
  duplicateStoryId: z.string().uuid().optional(),
  duplicateStoryIds: z.array(z.string().uuid()).optional(),
});

const mergeDecisionSchema = z.object({
  action: z.literal("merge"),
  storyType: storyTypeSchema,
  primaryStoryId: z.string().uuid(),
  duplicateStoryIds: z.array(z.string().uuid()).min(1),
});

const decisionSchema = z.discriminatedUnion("action", [
  keepSeparateDecisionSchema,
  mergeDecisionSchema,
]);

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

  const result =
    parsed.data.action === "merge"
      ? await mergeStoryTargets(parsed.data)
      : await keepStoryOverlapSeparate(parsed.data);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Story target not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_overlap_decision" },
      { status: 409 },
    );
  }
  if (result.status === "merged") {
    schedulePersonalEmbeddingsSync("story_target_merge");
  }

  return NextResponse.json({ data: result });
}
