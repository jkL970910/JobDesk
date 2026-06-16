import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getProjectDedupeCandidates,
  keepProjectOverlapSeparate,
  mergeProjectCards,
} from "../../../../src/server/profile-evidence-repository";

const decisionSchema = z.object({
  action: z.enum(["merge", "keep_separate"]).default("merge"),
  primaryProjectId: z.string().uuid(),
  duplicateProjectId: z.string().uuid().optional(),
  duplicateProjectIds: z.array(z.string().uuid()).optional(),
});

export async function GET() {
  const result = await getProjectDedupeCandidates(8);
  return NextResponse.json({ data: result });
}

export async function POST(request: Request) {
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project overlap request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result =
    parsed.data.action === "keep_separate"
      ? await keepProjectOverlapSeparate(parsed.data)
      : await mergeProjectCards(parsed.data);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Project card not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_overlap_decision" },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: result });
}
