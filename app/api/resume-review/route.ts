import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  parseResumeSourceFile,
  ResumeSourceParseError,
} from "../../../src/server/resume-source-parser";
import {
  createResumeSourceVersion,
  getResumeReviewWorkspace,
} from "../../../src/server/resume-review-repository";

export const runtime = "nodejs";

export async function GET() {
  const result = await getResumeReviewWorkspace();
  return NextResponse.json({ data: result });
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Upload a resume file.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const parsed = await parseResumeSourceFile({
      filename: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    if (parsed.parseQuality.status === "needs_ocr" || parsed.parseQuality.status === "failed") {
      return NextResponse.json(
        {
          error:
            "This resume file does not contain enough readable text for review. Upload a text-layer PDF/DOCX or paste the text manually.",
          kind: parsed.parseQuality.status,
          data: {
            parseQuality: parsed.parseQuality,
            parseAttempts: parsed.parseAttempts,
            sourceTitle: parsed.sourceTitle,
            sourceKind: parsed.sourceKind,
          },
        },
        { status: 422 },
      );
    }
    const result = await createResumeSourceVersion({
      sourceTitle: parsed.sourceTitle,
      sourceText: parsed.sourceText,
      sourceKind: parsed.sourceKind,
      parseMetadata: parsed,
    });
    return NextResponse.json({
      data: {
        ...result,
        parseWarnings: parsed.warnings,
        parseQuality: parsed.parseQuality,
        parseAttempts: parsed.parseAttempts,
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
                parseAttempts: error.parseAttempts,
              }
            : undefined,
        },
        { status },
      );
    }

    return NextResponse.json(
      { error: "Resume review failed.", kind: "review_failed" },
      { status: 500 },
    );
  }
}
