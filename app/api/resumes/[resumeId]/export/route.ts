import { NextResponse } from "next/server";
import { z } from "zod";

import { getResumeFinalExportBlocker } from "../../../../../src/server/main-resume-export-policy";
import {
  parseResumeExportFormat,
  parseResumeExportTemplate,
  parseResumePagePolicy,
  renderResumeExportResponse,
} from "../../../../../src/server/resume-export-renderer";
import { getTailoredResumeById } from "../../../../../src/server/resume-repository";

export const runtime = "nodejs";

const paramsSchema = z.object({
  resumeId: z.string().uuid(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ resumeId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json(
      { error: "Invalid resume export request.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const format = parseResumeExportFormat(url.searchParams.get("format") ?? "markdown");
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported export format.", kind: "unsupported_format" },
      { status: 400 },
    );
  }

  const resume = await getTailoredResumeById(params.data.resumeId);
  if (!resume) {
    return NextResponse.json(
      { error: "Resume not found.", kind: "not_found" },
      { status: 404 },
    );
  }
  const exportBlocker = getResumeFinalExportBlocker({
    format,
    status: resume.status,
  });
  if (exportBlocker) {
    return NextResponse.json(exportBlocker, { status: 409 });
  }

  const template = parseResumeExportTemplate(url.searchParams.get("template"));
  const pagePolicy = parseResumePagePolicy(url.searchParams.get("pagePolicy"));
  const exported = await renderResumeExportResponse({
    format,
    jsonBody: resume,
    pagePolicy,
    resumeJson: resume.resume_json,
    resumeMarkdown: resume.resume_markdown,
    template,
    title: resume.title,
  });
  return new NextResponse(exported.body, {
    headers: {
      "Content-Disposition": exported.contentDisposition,
      "Content-Type": exported.contentType,
      ...exported.headers,
    },
  });
}
