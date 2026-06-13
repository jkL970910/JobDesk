import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getProjectDedupeCandidates,
  mergeProjectCards,
} from "../../../../src/server/profile-evidence-repository";

const mergeSchema = z.object({
  primaryProjectId: z.string().uuid(),
  duplicateProjectId: z.string().uuid().optional(),
  duplicateProjectIds: z.array(z.string().uuid()).optional(),
});

export async function GET() {
  const result = await getProjectDedupeCandidates(8);
  return NextResponse.json({ data: result });
}

export async function POST(request: Request) {
  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project merge request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await mergeProjectCards(parsed.data);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Project card not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: result.reason, kind: "invalid_merge" },
      { status: 409 },
    );
  }

  return NextResponse.json({ data: result });
}
