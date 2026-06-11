import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import {
  parseResumeSourceFile,
  ResumeSourceParseError,
} from "../../../../src/server/resume-source-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Upload a resume source file.", kind: "invalid_request" },
      { status: 400 },
    );
  }

  try {
    const parsed = await parseResumeSourceFile({
      filename: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ data: parsed });
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
      { error: "Resume source parsing failed.", kind: "parse_failed" },
      { status: 500 },
    );
  }
}
