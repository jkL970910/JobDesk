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
    const result = await createResumeSourceVersion({
      sourceTitle: parsed.sourceTitle,
      sourceText: parsed.sourceText,
      sourceKind: parsed.sourceKind,
    });
    return NextResponse.json({
      data: {
        ...result,
        parseWarnings: parsed.warnings,
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
        { error: error.message, kind: error.kind },
        { status },
      );
    }

    return NextResponse.json(
      { error: "Resume review failed.", kind: "review_failed" },
      { status: 500 },
    );
  }
}
