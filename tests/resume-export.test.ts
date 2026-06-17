import { describe, expect, it } from "vitest";

import { getMainResumeExportBlocker } from "../src/server/main-resume-export-policy";
import {
  applyResumePagePolicy,
  buildResumeExportViewModel,
  renderPlainAtsDocx,
  renderPlainAtsHtml,
} from "../src/server/resume-export-renderer";
import { validateBulletClaimCoverage } from "../src/server/tailored-resume-guardrails";

describe("resume export coverage assumptions", () => {
  it("keeps a generated bullet mapped when extra claim ledger entries exist", () => {
    const result = validateBulletClaimCoverage({
      resumeMarkdown: "## Experience\n- Built SQL dashboards for onboarding funnel analysis.",
      claims: [
        "Built SQL dashboards for onboarding funnel analysis.",
        "Candidate has SQL experience.",
      ],
    });

    expect(result).toEqual({ passed: true, reason: null });
  });

  it("blocks final resume exports until a main resume is Fact Guard validated", () => {
    expect(
      getMainResumeExportBlocker({ format: "markdown", status: "unvalidated" }),
    ).toMatchObject({
      kind: "resume_not_validated",
    });
    expect(
      getMainResumeExportBlocker({ format: "docx", status: "unvalidated" }),
    ).toMatchObject({
      kind: "resume_not_validated",
    });
    expect(
      getMainResumeExportBlocker({ format: "html", status: "unvalidated" }),
    ).toMatchObject({
      kind: "resume_not_validated",
    });
    expect(getMainResumeExportBlocker({ format: "json", status: "unvalidated" })).toBeNull();
    expect(getMainResumeExportBlocker({ format: "markdown", status: "validated" })).toBeNull();
    expect(getMainResumeExportBlocker({ format: "docx", status: "validated" })).toBeNull();
    expect(getMainResumeExportBlocker({ format: "html", status: "validated" })).toBeNull();
  });

  it("normalizes structured resume JSON into an export view model", () => {
    const viewModel = buildResumeExportViewModel({
      resumeJson: {
        sections: [
          {
            title: "Experience",
            bullets: [
              { text: "Launched onboarding analytics dashboards." },
              "Improved activation reporting.",
            ],
          },
        ],
      },
      resumeMarkdown: "## Fallback\n- Should not be used",
      title: "Main Resume",
    });

    expect(viewModel).toEqual({
      sections: [
        {
          body: [],
          bullets: [
            "Launched onboarding analytics dashboards.",
            "Improved activation reporting.",
          ],
          title: "Experience",
        },
      ],
      title: "Main Resume",
    });
  });

  it("falls back to markdown sections and applies one-page trimming", () => {
    const viewModel = buildResumeExportViewModel({
      resumeJson: null,
      resumeMarkdown:
        "## Experience\n- One\n- Two\n- Three\n- Four\n- Five\n## Projects\n- Alpha",
      title: "Fallback Resume",
    });
    const onePage = applyResumePagePolicy(viewModel, "one_page");

    expect(viewModel.sections[0]?.bullets).toHaveLength(5);
    expect(onePage.sections[0]?.bullets).toEqual(["One", "Two", "Three", "Four"]);
  });

  it("renders printable ATS HTML", () => {
    const html = renderPlainAtsHtml({
      viewModel: {
        sections: [{ body: [], bullets: ["Built evidence-backed resume workflow."], title: "Experience" }],
        title: "Main Resume",
      },
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("@page");
    expect(html).toContain("Built evidence-backed resume workflow.");
  });

  it("renders DOCX content as a zip package", async () => {
    const buffer = await renderPlainAtsDocx({
      viewModel: {
        sections: [{ body: [], bullets: ["Built evidence-backed resume workflow."], title: "Experience" }],
        title: "Main Resume",
      },
    });

    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });
});
