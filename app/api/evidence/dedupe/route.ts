import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getEvidenceDedupeCandidates,
  mergeEvidenceItems,
} from "../../../../src/server/profile-evidence-repository";

const mergeSchema = z.object({
  primaryEvidenceId: z.string().uuid(),
  duplicateEvidenceId: z.string().uuid(),
});

export async function GET() {
  const result = await getEvidenceDedupeCandidates(8);
  return NextResponse.json({ data: result });
}

export async function POST(request: Request) {
  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid evidence merge request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const result = await mergeEvidenceItems(parsed.data);
  if (result.status === "not_found") {
    return NextResponse.json(
      { error: "Evidence item not found.", kind: "not_found" },
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
