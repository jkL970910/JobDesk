import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
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
    ].join("\r\n");

    const result = await parseResumeSourceFile({
      filename: "../Jane Resume.txt",
      buffer: Buffer.from(source),
    });

    expect(result).toMatchObject({
      sourceTitle: "Jane Resume.txt",
      sourceKind: "text",
      warnings: [],
    });
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

  it("rejects files without enough readable text", async () => {
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
});
