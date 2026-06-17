import { NextResponse } from "next/server";
import { z } from "zod";

import { getMainResumeById } from "../../../../../src/server/resume-repository";

const paramsSchema = z.object({
  mainResumeId: z.string().uuid(),
});

const formatSchema = z.enum(["markdown", "json"]).default("markdown");

export async function GET(
  request: Request,
  context: { params: Promise<{ mainResumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid main resume export request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const format = formatSchema.safeParse(url.searchParams.get("format") ?? undefined);
  if (!format.success) {
    return NextResponse.json(
      { error: "Unsupported export format.", kind: "unsupported_format" },
      { status: 400 },
    );
  }

  const resume = await getMainResumeById(params.data.mainResumeId);
  if (!resume) {
    return NextResponse.json(
      { error: "Main resume not found.", kind: "not_found" },
      { status: 404 },
    );
  }

  const filename = makeExportFilename(resume.title, format.data);
  if (format.data === "json") {
    return new NextResponse(JSON.stringify(resume, null, 2), {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  return new NextResponse(resume.resume_markdown, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

function makeExportFilename(title: string, format: "markdown" | "json") {
  const safeTitle =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "main-resume";
  return `${safeTitle}.${format === "markdown" ? "md" : "json"}`;
}
