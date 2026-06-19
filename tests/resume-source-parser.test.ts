import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  buildParseQuality,
  normalizeExtractedText,
  parseResumeSourceFile,
  ResumeSourceParseError,
  resumeSourceMaxBytes,
} from "../src/server/resume-source-parser";

describe("resume source parser", () => {
  it("parses and normalizes plain text resume sources", async () => {
    const source = [
      "Jane Doe",
      "",
      "Senior Product Analyst",
      "Built SQL dashboards for onboarding funnel analysis and activation metrics.",
      "Led experimentation readouts for product teams and improved stakeholder reporting.",
      "Skills: SQL, product analytics, experimentation, dashboard development.",
      "Owned weekly metric reviews, translated ambiguous product questions into reliable analysis,",
      "and documented evidence-backed project outcomes for reusable resume and interview material.",
      "Partnered with engineering, design, and operations stakeholders to clarify scope, risks,",
      "and launch decisions across multiple onboarding improvements.",
    ].join("\r\n");

    const result = await parseResumeSourceFile({
      filename: "../Jane Resume.txt",
      buffer: Buffer.from(source),
    });

    expect(result).toMatchObject({
      sourceTitle: "Jane Resume.txt",
      sourceKind: "text",
      parseQuality: {
        status: "warning",
      },
      parserName: "jobdesk-source-parser",
    });
    expect(result.parseQuality.charCount).toBeGreaterThan(80);
    expect(result.parseQuality.wordCount).toBeGreaterThan(20);
    expect(result.sourceText).toContain("Jane Doe\n\nSenior Product Analyst");
    expect(result.sourceText).not.toContain("\r");
  });

  it("rejects unsupported file types", async () => {
    await expect(
      parseResumeSourceFile({
        filename: "resume.pages",
        buffer: Buffer.from("not supported but long enough ".repeat(10)),
      }),
    ).rejects.toMatchObject({
      kind: "unsupported_file_type",
    } satisfies Partial<ResumeSourceParseError>);
  });

  it("marks short but readable text with parse quality warnings", async () => {
    const result = await parseResumeSourceFile({
      filename: "resume.md",
      buffer: Buffer.from("Jane Doe built SQL dashboards for product analytics."),
    });

    expect(result.parseQuality.status).toBe("warning");
    expect(result.parseQuality.warnings).toContain("low_text_density");
  });

  it("rejects files without any meaningful readable text", async () => {
    await expect(
      parseResumeSourceFile({
        filename: "resume.md",
        buffer: Buffer.from("Jane Doe"),
      }),
    ).rejects.toMatchObject({
      kind: "no_readable_text",
    } satisfies Partial<ResumeSourceParseError>);
  });

  it("rejects oversized files before parsing", async () => {
    await expect(
      parseResumeSourceFile({
        filename: "resume.txt",
        buffer: Buffer.alloc(resumeSourceMaxBytes + 1),
      }),
    ).rejects.toMatchObject({
      kind: "file_too_large",
    } satisfies Partial<ResumeSourceParseError>);
  });

  it("normalizes extracted parser text", () => {
    expect(normalizeExtractedText(" A\t\tB \r\n\r\n\r\n C\u0000 ")).toBe(
      "A B\n\nC",
    );
  });

  it("marks low-density PDF text as a quality warning before OCR", () => {
    const quality = buildParseQuality("Jane Doe resume text with some visible words", {
      pageCount: 2,
      sourceKind: "pdf",
    });

    expect(quality.status).toBe("warning");
    expect(quality.warnings).toContain("low_text_quality");
    expect(quality.warnings).not.toContain("possible_scanned_pdf");
  });

  it("marks PDF pages with no extracted text as needing OCR instead of password protection", () => {
    const quality = buildParseQuality("", {
      pageCount: 1,
      sourceKind: "pdf",
    });

    expect(quality.status).toBe("needs_ocr");
    expect(quality.charCount).toBe(0);
    expect(quality.warnings).toContain("text_extraction_failed");
    expect(quality.warnings).toContain("possible_scanned_pdf");
  });

  it("reports fallback extractor attempts when PDF parsing fails", async () => {
    await expect(
      parseResumeSourceFile({
        filename: "broken.pdf",
        buffer: Buffer.from("not actually a pdf but long enough to reach the parser"),
      }),
    ).rejects.toMatchObject({
      kind: "parser_failed",
      parseAttempts: expect.arrayContaining([
        expect.objectContaining({
          extractor: "pdf-parse",
          status: "failed",
        }),
        expect.objectContaining({
          extractor: "pdftotext",
          status: "failed",
          errorKind: "extractor_not_enabled",
          warnings: expect.arrayContaining(["pdftotext_not_enabled"]),
        }),
      ]),
    } satisfies Partial<ResumeSourceParseError>);
  });
});
