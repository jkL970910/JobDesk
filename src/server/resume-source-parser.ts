import { Buffer } from "node:buffer";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const pdfParseModuleUrl = pathToFileURL(
  join(process.cwd(), "node_modules/pdf-parse/dist/pdf-parse/esm/index.js"),
).href;
const pdfParseWorkerUrl = pathToFileURL(
  join(process.cwd(), "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs"),
).href;
const importRuntimeModule = new Function(
  "specifier",
  "return import(specifier)",
) as <T>(specifier: string) => Promise<T>;

export const resumeSourceMaxBytes = 8 * 1024 * 1024;

export type ResumeSourceParseResult = {
  sourceTitle: string;
  sourceText: string;
  sourceKind: "text" | "markdown" | "docx" | "pdf";
  warnings: string[];
};

export class ResumeSourceParseError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "empty_file"
      | "file_too_large"
      | "unsupported_file_type"
      | "encrypted_or_unreadable_pdf"
      | "no_readable_text",
  ) {
    super(message);
    this.name = "ResumeSourceParseError";
  }
}

export async function parseResumeSourceFile(args: {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<ResumeSourceParseResult> {
  const sourceTitle = sanitizeFilename(args.filename);
  if (args.buffer.length === 0) {
    throw new ResumeSourceParseError("Resume source file is empty.", "empty_file");
  }
  if (args.buffer.length > resumeSourceMaxBytes) {
    throw new ResumeSourceParseError(
      "Resume source file is too large. Keep it under 8 MB.",
      "file_too_large",
    );
  }

  const extension = inferExtension(sourceTitle);
  if (extension === ".txt") {
    return {
      sourceTitle,
      sourceKind: "text",
      sourceText: requireReadableText(decodeText(args.buffer)),
      warnings: [],
    };
  }
  if (extension === ".md" || extension === ".markdown") {
    return {
      sourceTitle,
      sourceKind: "markdown",
      sourceText: requireReadableText(decodeText(args.buffer)),
      warnings: [],
    };
  }
  if (extension === ".docx") {
    return parseDocx({ buffer: args.buffer, sourceTitle });
  }
  if (extension === ".pdf") {
    return parsePdf({ buffer: args.buffer, sourceTitle });
  }

  throw new ResumeSourceParseError(
    "Unsupported resume source type. Upload .pdf, .docx, .txt, or .md.",
    "unsupported_file_type",
  );
}

async function parseDocx(args: {
  buffer: Buffer;
  sourceTitle: string;
}): Promise<ResumeSourceParseResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: args.buffer });
  const sourceText = requireReadableText(result.value);
  return {
    sourceTitle: args.sourceTitle,
    sourceKind: "docx",
    sourceText,
    warnings: result.messages.map((message) => message.message),
  };
}

async function parsePdf(args: {
  buffer: Buffer;
  sourceTitle: string;
}): Promise<ResumeSourceParseResult> {
  try {
    const { PDFParse } =
      await importRuntimeModule<typeof import("pdf-parse")>(pdfParseModuleUrl);
    PDFParse.setWorker(pdfParseWorkerUrl);
    const parser = new PDFParse({ data: args.buffer });
    try {
      const result = await parser.getText();
      return {
        sourceTitle: args.sourceTitle,
        sourceKind: "pdf",
        sourceText: requireReadableText(result.text),
        warnings: [],
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    if (error instanceof ResumeSourceParseError) throw error;
    throw new ResumeSourceParseError(
      "Could not extract readable text from this PDF. If it is scanned or password-protected, export it to text or DOCX first.",
      "encrypted_or_unreadable_pdf",
    );
  }
}

function requireReadableText(text: string) {
  const normalized = normalizeExtractedText(text);
  if (normalized.length < 80) {
    throw new ResumeSourceParseError(
      "Resume source file does not contain enough readable text.",
      "no_readable_text",
    );
  }
  return normalized;
}

export function normalizeExtractedText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeText(buffer: Buffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function inferExtension(filename: string) {
  return filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
}

function sanitizeFilename(filename: string) {
  const basename = filename.split(/[\\/]+/).pop() ?? filename;
  return (
    basename
      .replace(/^\.+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240) || "Resume source"
  );
}
