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
export const sourceParserName = "jobdesk-source-parser" as const;
export const sourceParserVersion = "document-lifecycle-v1" as const;

export type ParseQualityStatus = "usable" | "warning" | "needs_ocr" | "failed";

export type ParseQuality = {
  status: ParseQualityStatus;
  charCount: number;
  wordCount: number;
  pageCount?: number;
  warnings: string[];
};

export type ResumeSourceParseResult = {
  sourceTitle: string;
  sourceText: string;
  sourceKind: "text" | "markdown" | "docx" | "pdf";
  warnings: string[];
  parseQuality: ParseQuality;
  parserName: typeof sourceParserName;
  parserVersion: typeof sourceParserVersion;
  originalFilename: string;
  mimeType?: string;
  fileSizeBytes: number;
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
    readonly parseQuality?: ParseQuality,
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
    const sourceText = normalizeExtractedText(decodeText(args.buffer));
    assertReadableText(sourceText);
    return {
      ...baseResultMetadata(args, sourceTitle, "text"),
      sourceKind: "text",
      sourceText,
      ...qualityFields(sourceText),
    };
  }
  if (extension === ".md" || extension === ".markdown") {
    const sourceText = normalizeExtractedText(decodeText(args.buffer));
    assertReadableText(sourceText);
    return {
      ...baseResultMetadata(args, sourceTitle, "markdown"),
      sourceKind: "markdown",
      sourceText,
      ...qualityFields(sourceText),
    };
  }
  if (extension === ".docx") {
    return parseDocx({
      buffer: args.buffer,
      filename: args.filename,
      mimeType: args.mimeType,
      sourceTitle,
    });
  }
  if (extension === ".pdf") {
    return parsePdf({
      buffer: args.buffer,
      filename: args.filename,
      mimeType: args.mimeType,
      sourceTitle,
    });
  }

  throw new ResumeSourceParseError(
    "Unsupported resume source type. Upload .pdf, .docx, .txt, or .md.",
    "unsupported_file_type",
  );
}

async function parseDocx(args: {
  buffer: Buffer;
  sourceTitle: string;
  filename?: string;
  mimeType?: string;
}): Promise<ResumeSourceParseResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: args.buffer });
  const sourceText = normalizeExtractedText(result.value);
  assertReadableText(sourceText);
  const parserWarnings = result.messages.map((message) => message.message);
  return {
    ...baseResultMetadata(
      { filename: args.filename ?? args.sourceTitle, mimeType: args.mimeType, buffer: args.buffer },
      args.sourceTitle,
      "docx",
    ),
    sourceTitle: args.sourceTitle,
    sourceKind: "docx",
    sourceText,
    ...qualityFields(sourceText, { warnings: parserWarnings }),
  };
}

async function parsePdf(args: {
  buffer: Buffer;
  sourceTitle: string;
  filename?: string;
  mimeType?: string;
}): Promise<ResumeSourceParseResult> {
  try {
    const { PDFParse } =
      await importRuntimeModule<typeof import("pdf-parse")>(pdfParseModuleUrl);
    PDFParse.setWorker(pdfParseWorkerUrl);
    const parser = new PDFParse({ data: args.buffer });
    try {
      const result = await parser.getText();
      const sourceText = normalizeExtractedText(result.text);
      const pageCount = extractPdfPageCount(result);
      const quality = buildParseQuality(sourceText, { pageCount, sourceKind: "pdf" });
      if (quality.status === "failed") {
        throw new ResumeSourceParseError(
          "PDF source file does not contain enough readable text.",
          "no_readable_text",
          quality,
        );
      }
      return {
        ...baseResultMetadata(
          { filename: args.filename ?? args.sourceTitle, mimeType: args.mimeType, buffer: args.buffer },
          args.sourceTitle,
          "pdf",
        ),
        sourceTitle: args.sourceTitle,
        sourceKind: "pdf",
        sourceText,
        warnings: quality.warnings,
        parseQuality: quality,
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    if (error instanceof ResumeSourceParseError) throw error;
    const fallbackQuality = buildParseQuality("", { sourceKind: "pdf" });
    throw new ResumeSourceParseError(
      "Could not parse this PDF. It may use an unsupported PDF structure, be damaged, or require a password. Export it to DOCX/text, or paste the resume text manually.",
      "encrypted_or_unreadable_pdf",
      fallbackQuality,
    );
  }
}

function assertReadableText(normalized: string) {
  if (normalized.length < 20) {
    throw new ResumeSourceParseError(
      "Resume source file does not contain enough readable text.",
      "no_readable_text",
      buildParseQuality(normalized),
    );
  }
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

function baseResultMetadata(
  args: { filename: string; mimeType?: string; buffer: Buffer },
  sourceTitle: string,
  sourceKind: ResumeSourceParseResult["sourceKind"],
): Pick<
  ResumeSourceParseResult,
  | "sourceTitle"
  | "sourceKind"
  | "parserName"
  | "parserVersion"
  | "originalFilename"
  | "mimeType"
  | "fileSizeBytes"
> {
  return {
    sourceTitle,
    sourceKind,
    parserName: sourceParserName,
    parserVersion: sourceParserVersion,
    originalFilename: args.filename,
    mimeType: args.mimeType,
    fileSizeBytes: args.buffer.length,
  };
}

function qualityFields(
  sourceText: string,
  options: { warnings?: string[]; pageCount?: number; sourceKind?: ResumeSourceParseResult["sourceKind"] } = {},
) {
  const parseQuality = buildParseQuality(sourceText, options);
  return {
    warnings: parseQuality.warnings,
    parseQuality,
  };
}

export function buildParseQuality(
  sourceText: string,
  options: {
    warnings?: string[];
    pageCount?: number;
    sourceKind?: ResumeSourceParseResult["sourceKind"];
  } = {},
): ParseQuality {
  const charCount = sourceText.length;
  const wordCount = countWords(sourceText);
  const warnings = [...(options.warnings ?? [])];
  const replacementCount = (sourceText.match(/\uFFFD/g) ?? []).length;

  if (
    options.sourceKind === "pdf" &&
    typeof options.pageCount === "number" &&
    options.pageCount > 0 &&
    (charCount < 300 || wordCount < 80)
  ) {
    if (charCount < 20) warnings.push("text_extraction_failed");
    if (charCount < 300) warnings.push("low_text_density");
    if (wordCount < 80) warnings.push("low_word_count");
    warnings.push("possible_scanned_pdf");
    return {
      status: "needs_ocr",
      charCount,
      wordCount,
      pageCount: options.pageCount,
      warnings: uniqueWarnings(warnings),
    };
  }

  if (charCount < 20) {
    return {
      status: "failed",
      charCount,
      wordCount,
      pageCount: options.pageCount,
      warnings: uniqueWarnings([...warnings, "text_extraction_failed"]),
    };
  }

  if (charCount < 300) warnings.push("low_text_density");
  if (wordCount < 80) warnings.push("low_word_count");
  if (replacementCount > Math.max(3, charCount * 0.01)) {
    warnings.push("replacement_characters_detected");
  }
  if (hasRepeatedLineNoise(sourceText)) warnings.push("possible_header_footer_noise");

  return {
    status: warnings.length ? "warning" : "usable",
    charCount,
    wordCount,
    pageCount: options.pageCount,
    warnings: uniqueWarnings(warnings),
  };
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function uniqueWarnings(warnings: string[]) {
  return [...new Set(warnings.filter(Boolean))];
}

function hasRepeatedLineNoise(text: string) {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    const normalized = line.trim().toLowerCase();
    if (normalized.length < 8 || normalized.length > 120) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 4);
}

function extractPdfPageCount(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const candidates = [
    (result as { total?: unknown }).total,
    (result as { numpages?: unknown }).numpages,
    (result as { pages?: unknown[] }).pages?.length,
  ];
  const pageCount = candidates.find((candidate) => typeof candidate === "number");
  return typeof pageCount === "number" && Number.isFinite(pageCount) ? pageCount : undefined;
}
