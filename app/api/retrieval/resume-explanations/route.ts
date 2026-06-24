import { NextResponse } from "next/server";
import { z } from "zod";

import { getJdAnalysisById } from "../../../../src/server/job-repository";
import {
  buildResumeRetrievalContextFromQuery,
  retrieveResumeEvidenceForJob,
  retrieveSourceMaterialForEvidenceGaps,
} from "../../../../src/server/retrieval-service";

const requestSchema = z.object({
  jobId: z.string().uuid().optional(),
  query: z.string().trim().min(3).max(2000).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid retrieval explanation request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const limit = parsed.data.limit ?? 12;
  const job = parsed.data.jobId ? await getJdAnalysisById(parsed.data.jobId) : null;
  if (parsed.data.jobId && !job) {
    return NextResponse.json(
      { error: "Job not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  const sourceQuery =
    parsed.data.query?.trim() ||
    job?.requirements?.map((item: { text: string }) => item.text).join(" ") ||
    job?.keywords?.join(" ") ||
    "";
  const retrievalContext =
    job ?? (sourceQuery ? buildResumeRetrievalContextFromQuery(sourceQuery) : null);
  const evidence = await retrieveResumeEvidenceForJob(retrievalContext, { limit });
  const sourceMaterial = sourceQuery
    ? await retrieveSourceMaterialForEvidenceGaps(sourceQuery, {
        limit: Math.min(limit, 8),
      })
    : [];

  return NextResponse.json({
    data: {
      evidence,
      sourceMaterial,
      job: job
        ? {
            id: job.id,
            title: job.title,
            keywords: job.keywords,
            requirements: job.requirements,
          }
        : null,
      note: "Usable evidence is separated from possible source material. Source chunks require conversion or evidence enrichment before resume use.",
    },
  });
}
