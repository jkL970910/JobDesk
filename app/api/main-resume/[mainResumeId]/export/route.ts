import { NextResponse } from "next/server";
import { z } from "zod";

import { getMainResumeExportBlocker } from "../../../../../src/server/main-resume-export-policy";
import {
  applyResumePagePolicy,
  buildResumeExportViewModel,
  getResumeExportContentType,
  makeResumeTrimHeaders,
  makeResumeExportFilename,
  parseResumeExportFormat,
  parseResumeExportTemplate,
  parseResumePagePolicy,
  renderPlainAtsDocx,
  renderPlainAtsHtml,
} from "../../../../../src/server/resume-export-renderer";
import { getMainResumeById } from "../../../../../src/server/resume-repository";

export const runtime = "nodejs";

const paramsSchema = z.object({
  mainResumeId: z.string().uuid(),
});

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
  const format = parseResumeExportFormat(url.searchParams.get("format") ?? "markdown");
  if (!format) {
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
  const exportBlocker = getMainResumeExportBlocker({
    format,
    status: resume.status,
  });
  if (exportBlocker) {
    return NextResponse.json(
      exportBlocker,
      { status: 409 },
    );
  }

  const filename = makeResumeExportFilename(resume.title, format);
  if (format === "json") {
    return new NextResponse(JSON.stringify(resume, null, 2), {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": getResumeExportContentType(format),
      },
    });
  }

  if (format === "markdown") {
    return new NextResponse(resume.resume_markdown, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": getResumeExportContentType(format),
      },
    });
  }

  const template = parseResumeExportTemplate(url.searchParams.get("template"));
  const pagePolicy = parseResumePagePolicy(url.searchParams.get("pagePolicy"));
  const viewModel = buildResumeExportViewModel({
    resumeJson: resume.resume_json,
    resumeMarkdown: resume.resume_markdown,
    title: resume.title,
  });
  const { trim } = applyResumePagePolicy(viewModel, pagePolicy);
  const trimHeaders = makeResumeTrimHeaders(trim);

  if (format === "html") {
    return new NextResponse(renderPlainAtsHtml({ pagePolicy, template, viewModel }), {
      headers: {
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Type": getResumeExportContentType(format),
        ...trimHeaders,
      },
    });
  }

  const buffer = await renderPlainAtsDocx({ pagePolicy, template, viewModel });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": getResumeExportContentType(format),
      ...trimHeaders,
    },
  });
}
