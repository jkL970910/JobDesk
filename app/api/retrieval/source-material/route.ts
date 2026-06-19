import { NextResponse } from "next/server";
import { z } from "zod";

import { retrieveSourceMaterialForEvidenceGaps } from "../../../../src/server/retrieval-service";

const requestSchema = z.object({
  query: z.string().trim().min(3).max(2000),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid source material retrieval request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const items = await retrieveSourceMaterialForEvidenceGaps(parsed.data.query, {
    limit: parsed.data.limit,
  });
  return NextResponse.json({
    data: {
      policy: "evidence_enrichment",
      usage: "possible_source_material",
      note: "Source chunks are retrieval hints for creating or enriching evidence. They are not resume-ready evidence.",
      items,
    },
  });
}
