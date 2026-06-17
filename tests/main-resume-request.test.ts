import { describe, expect, it } from "vitest";

import {
  getMainResumeRefreshSourceId,
  inferMainResumeGenerationMode,
  MainResumePostRequest,
  MainResumeRequestError,
  validateMainResumeModeSelection,
} from "../src/server/main-resume-request";

const resumeSourceId = "11111111-1111-4111-8111-111111111111";
const positioningReportId = "22222222-2222-4222-8222-222222222222";

describe("MainResumePostRequest", () => {
  it("accepts the public resume refresh request shape", () => {
    const parsed = MainResumePostRequest.parse({
      mode: "resume_refresh",
      sourceResumeVersionId: resumeSourceId,
      refreshMode: "balanced_rewrite",
      styleConstraints: {
        atsFriendly: true,
        preserveSectionOrder: true,
        targetLength: "one_page",
        tone: "concise",
      },
    });

    expect(inferMainResumeGenerationMode(parsed)).toBe("resume_refresh");
    expect(getMainResumeRefreshSourceId(parsed)).toBe(resumeSourceId);
    expect(validateMainResumeModeSelection(parsed)).toBe("resume_refresh");
  });

  it("keeps compatibility with the previous refresh field names", () => {
    const parsed = MainResumePostRequest.parse({
      generationMode: "resume_refresh",
      refreshSourceResumeId: resumeSourceId,
      refreshMode: "conservative_update",
    });

    expect(inferMainResumeGenerationMode(parsed)).toBe("resume_refresh");
    expect(getMainResumeRefreshSourceId(parsed)).toBe(resumeSourceId);
  });

  it("requires source resume and refresh mode for resume refresh", () => {
    expect(() =>
      validateMainResumeModeSelection({ mode: "resume_refresh" }),
    ).toThrow(MainResumeRequestError);
    expect(() =>
      validateMainResumeModeSelection({
        mode: "resume_refresh",
        sourceResumeVersionId: resumeSourceId,
      }),
    ).toThrow(MainResumeRequestError);
  });

  it("requires report and direction for positioning variants", () => {
    expect(() =>
      validateMainResumeModeSelection({ mode: "positioning_variant" }),
    ).toThrow(MainResumeRequestError);

    expect(
      validateMainResumeModeSelection({
        mode: "positioning_variant",
        positioningReportId,
        positioningDirectionId: "ai-pm",
      }),
    ).toBe("positioning_variant");
  });

  it("does not require extra fields for the default main resume mode", () => {
    expect(validateMainResumeModeSelection({ mode: "main_resume" })).toBe(
      "main_resume",
    );
    expect(inferMainResumeGenerationMode(undefined)).toBe("main_resume");
  });
});
