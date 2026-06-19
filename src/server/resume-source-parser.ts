import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

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
const execFileAsync = promisify(execFile);

type PdfParseInstance = {
  getText: (params?: PdfParseParams) => Promise<unknown>;
};

type PdfParseParams = {
  cellSeparator?: string;
  disableNormalization?: boolean;
  itemJoiner?: string;
  lineEnforce?: boolean;
  pageJoiner?: string;
};

type PdfExtractionResult = {
  sourceText: string;
  quality: ParseQuality;
  attempt: ParseAttempt;
};

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

export type ParseAttempt = {
  extractor: "pdf-parse" | "pdfjs-text-content" | "pdftotext";
  status: "success" | "failed";
  charCount: number;
  warnings: string[];
  errorKind?:
    | "invalid_pdf"
    | "password_required"
    | "unsupported_pdf_structure"
    | "extractor_unavailable"
    | "text_extraction_failed";
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
  parseAttempts?: ParseAttempt[];
};

export class ResumeSourceParseError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "empty_file"
      | "file_too_large"
      | "unsupported_file_type"
      | "encrypted_or_unreadable_pdf"
      | "parser_failed"
      | "no_readable_text",
    readonly parseQuality?: ParseQuality,
    readonly parseAttempts?: ParseAttempt[],
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
  const attempts: ParseAttempt[] = [];
  try {
    const { PDFParse } =
      await importRuntimeModule<typeof import("pdf-parse")>(pdfParseModuleUrl);
    PDFParse.setWorker(pdfParseWorkerUrl);
    const parser = new PDFParse({ data: args.buffer });
    try {
      const primary = await parsePdfWithGetText(parser, {
        extractor: "pdf-parse",
      });
      attempts.push(primary.attempt);
      let selected = primary;

      if (shouldTryPdfTextContentFallback(primary.quality)) {
        const fallback = await parsePdfWithGetText(parser, {
          extractor: "pdfjs-text-content",
          params: {
            cellSeparator: " ",
            itemJoiner: " ",
            lineEnforce: false,
            pageJoiner: "",
          },
          warning: "pdf_text_content_fallback_used",
        });
        attempts.push(fallback.attempt);
        if (isBetterPdfExtraction(fallback.quality, primary.quality)) {
          selected = fallback;
        }
      }

      if (shouldTrySidecarPdfFallback(selected.quality)) {
        const sidecar = await parsePdfWithPdftotext({
          buffer: args.buffer,
          pageCount: selected.quality.pageCount,
        });
        attempts.push(sidecar.attempt);
        if (isBetterPdfExtraction(sidecar.quality, selected.quality)) {
          selected = sidecar;
        }
      }

      const quality = selected.quality;
      if (quality.status === "failed" || quality.status === "needs_ocr") {
        throw new ResumeSourceParseError(
          quality.status === "needs_ocr"
            ? "PDF source file appears to have too little extractable text. It may need OCR or a pasted text version."
            : "PDF source file does not contain enough readable text.",
          "no_readable_text",
          quality,
          attempts,
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
        sourceText: selected.sourceText,
        warnings: quality.warnings,
        parseQuality: quality,
        parseAttempts: attempts,
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    if (error instanceof ResumeSourceParseError) throw error;
    attempts.push({
      extractor: "pdf-parse",
      status: "failed",
      charCount: 0,
      warnings: ["parser_failed"],
      errorKind: classifyPdfParseError(error),
    });
    const sidecar = await parsePdfWithPdftotext({
      buffer: args.buffer,
    });
    attempts.push(sidecar.attempt);
    if (sidecar.quality.status !== "failed" && sidecar.quality.status !== "needs_ocr") {
      return {
        ...baseResultMetadata(
          { filename: args.filename ?? args.sourceTitle, mimeType: args.mimeType, buffer: args.buffer },
          args.sourceTitle,
          "pdf",
        ),
        sourceTitle: args.sourceTitle,
        sourceKind: "pdf",
        sourceText: sidecar.sourceText,
        warnings: sidecar.quality.warnings,
        parseQuality: sidecar.quality,
        parseAttempts: attempts,
      };
    }
    const fallbackQuality = buildParseQuality("", {
      sourceKind: "pdf",
      warnings: ["parser_failed"],
    });
    throw new ResumeSourceParseError(
      "Could not parse this PDF with the available text extractors. It may use an unsupported PDF structure, be damaged, or require a password. Export it to DOCX/text, or paste the resume text manually.",
      classifyPdfParseError(error) === "password_required"
        ? "encrypted_or_unreadable_pdf"
        : "parser_failed",
      fallbackQuality,
      attempts,
    );
  }
}

async function parsePdfWithPdftotext(args: {
  buffer: Buffer;
  pageCount?: number;
}): Promise<PdfExtractionResult> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "jobdesk-pdf-"));
  const inputPath = join(tempDirectory, "source.pdf");
  const outputPath = join(tempDirectory, "source.txt");
  try {
    await writeFile(inputPath, args.buffer);
    await execFileAsync("pdftotext", [
      "-layout",
      "-enc",
      "UTF-8",
      inputPath,
      outputPath,
    ], { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 });
    const sourceText = normalizeExtractedText(await readFile(outputPath, "utf8"));
    const quality = buildParseQuality(sourceText, {
      pageCount: args.pageCount,
      sourceKind: "pdf",
      warnings: ["pdftotext_fallback_used"],
    });
    return {
      sourceText,
      quality,
      attempt: {
        extractor: "pdftotext",
        status: "success",
        charCount: quality.charCount,
        warnings: quality.warnings,
      } satisfies ParseAttempt,
    };
  } catch (error) {
    const errorKind = classifyPdftotextError(error);
    const quality = buildParseQuality("", {
      pageCount: args.pageCount,
      sourceKind: "pdf",
      warnings: [
        errorKind === "extractor_unavailable"
          ? "pdftotext_unavailable"
          : "pdftotext_failed",
      ],
    });
    return {
      sourceText: "",
      quality,
      attempt: {
        extractor: "pdftotext",
        status: "failed",
        charCount: 0,
        warnings: quality.warnings,
        errorKind,
      } satisfies ParseAttempt,
    };
  } finally {
    await rm(tempDirectory, { force: true, recursive: true }).catch(() => undefined);
  }
}

async function parsePdfWithGetText(
  parser: PdfParseInstance,
  options: {
    extractor: ParseAttempt["extractor"];
    params?: PdfParseParams;
    warning?: string;
  },
): Promise<PdfExtractionResult> {
  try {
    const result = await parser.getText(options.params);
    const sourceText = normalizeExtractedText(getPdfTextResultText(result));
    const pageCount = extractPdfPageCount(result);
    const quality = buildParseQuality(sourceText, {
      pageCount,
      sourceKind: "pdf",
      warnings: options.warning ? [options.warning] : undefined,
    });
    return {
      sourceText,
      quality,
      attempt: {
        extractor: options.extractor,
        status: "success",
        charCount: quality.charCount,
        warnings: quality.warnings,
      } satisfies ParseAttempt,
    };
  } catch (error) {
    const quality = buildParseQuality("", {
      sourceKind: "pdf",
      warnings: ["parser_failed"],
    });
    return {
      sourceText: "",
      quality,
      attempt: {
        extractor: options.extractor,
        status: "failed",
        charCount: 0,
        warnings: quality.warnings,
        errorKind: classifyPdfParseError(error),
      } satisfies ParseAttempt,
    };
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

  if (charCount < 20) {
    if (options.sourceKind === "pdf" && typeof options.pageCount === "number" && options.pageCount > 0) {
      return {
        status: "needs_ocr",
        charCount,
        wordCount,
        pageCount: options.pageCount,
        warnings: uniqueWarnings([
          ...warnings,
          "text_extraction_failed",
          "possible_scanned_pdf",
        ]),
      };
    }
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
  if (
    options.sourceKind === "pdf" &&
    typeof options.pageCount === "number" &&
    options.pageCount > 0 &&
    (charCount < 300 || wordCount < 80)
  ) {
    warnings.push("low_text_quality");
  }
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

function shouldTryPdfTextContentFallback(quality: ParseQuality) {
  return (
    quality.status === "failed" ||
    quality.status === "needs_ocr" ||
    quality.warnings.includes("low_text_quality") ||
    quality.warnings.includes("parser_failed")
  );
}

function shouldTrySidecarPdfFallback(quality: ParseQuality) {
  return (
    quality.status === "failed" ||
    quality.status === "needs_ocr" ||
    quality.warnings.includes("low_text_quality") ||
    quality.warnings.includes("parser_failed")
  );
}

function isBetterPdfExtraction(candidate: ParseQuality, current: ParseQuality) {
  if (candidate.status === "failed") return false;
  if (current.status === "failed") return true;
  if (current.status === "needs_ocr" && candidate.status !== "needs_ocr") return true;
  return candidate.charCount > current.charCount * 1.25 && candidate.wordCount >= current.wordCount;
}

function classifyPdfParseError(error: unknown) {
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (name.includes("password") || message.includes("password") || message.includes("encrypted")) {
    return "password_required";
  }
  if (name.includes("invalid") || message.includes("invalid pdf") || message.includes("damaged")) {
    return "invalid_pdf";
  }
  return "unsupported_pdf_structure";
}

function classifyPdftotextError(error: unknown): ParseAttempt["errorKind"] {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : "";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (code === "enoent" || message.includes("enoent") || message.includes("not found")) {
    return "extractor_unavailable";
  }
  if (message.includes("password") || message.includes("encrypted")) {
    return "password_required";
  }
  if (message.includes("syntax error") || message.includes("damaged")) {
    return "invalid_pdf";
  }
  return "unsupported_pdf_structure";
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

function getPdfTextResultText(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const text = (result as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
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
