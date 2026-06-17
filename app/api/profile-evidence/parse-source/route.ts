import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  parseResumeSourceFile,
  ResumeSourceParseError,
} from "../../../../src/server/resume-source-parser";
import { persistParsedSourceDocument } from "../../../../src/server/source-document-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const sourceIntent = normalizeSourceIntent(formData?.get("sourceIntent"));
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Upload a source file.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const parsed = await parseResumeSourceFile({
      filename: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    const persistence =
      sourceIntent === "resume"
        ? null
        : await persistParsedSourceDocument({
            sourceType: sourceIntent,
            parsed,
          });
    return NextResponse.json({
      data: {
        sourceDocumentId:
          persistence?.status === "saved" ? persistence.sourceDocumentId : undefined,
        sourceTitle: parsed.sourceTitle,
        title: parsed.sourceTitle,
        sourceText: parsed.sourceText,
        sourceKind: parsed.sourceKind,
        sourceType: sourceIntent,
        parseQuality: parsed.parseQuality,
        warnings: parsed.warnings,
        duplicate:
          persistence?.status === "duplicate"
            ? {
                sourceDocumentId: persistence.duplicate.sourceDocumentId,
                title: persistence.duplicate.title,
                createdAt: persistence.duplicate.createdAt.toISOString(),
              }
            : undefined,
      },
    });
  } catch (error) {
    if (error instanceof ResumeSourceParseError) {
      const status =
        error.kind === "file_too_large"
          ? 413
          : error.kind === "unsupported_file_type"
            ? 415
            : 422;
      return NextResponse.json(
        {
          error: error.message,
          kind: error.kind,
          data: error.parseQuality
            ? {
                parseQuality: error.parseQuality,
              }
            : undefined,
        },
        { status },
      );
    }

    return NextResponse.json(
      { error: "Resume source parsing failed.", kind: "parse_failed" },
      { status: 500 },
    );
  }
}

function normalizeSourceIntent(value: FormDataEntryValue | null | undefined) {
  return value === "resume" ||
    value === "project_note" ||
    value === "work_summary" ||
    value === "performance_review" ||
    value === "jd_gap_note" ||
    value === "generic_source"
    ? value
    : "generic_source";
}
