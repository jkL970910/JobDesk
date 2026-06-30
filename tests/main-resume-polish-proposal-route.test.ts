import { describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/main-resume/[mainResumeId]/polish-proposal/route";
import {
  applyMainResumePolishProposal,
  reviewGeneratedMainResumeReadiness,
} from "../src/server/generated-resume-readiness-review";
import { runFactGuardForMainResume } from "../src/server/resume-repository";

vi.mock("../src/server/generated-resume-readiness-review", () => ({
  applyMainResumePolishProposal: vi.fn(),
  getMainResumePolishProposal: vi.fn(),
  reviewGeneratedMainResumeReadiness: vi.fn(),
}));

vi.mock("../src/server/resume-repository", () => ({
  runFactGuardForMainResume: vi.fn(),
}));

const mockedApply = vi.mocked(applyMainResumePolishProposal);
const mockedFactGuard = vi.mocked(runFactGuardForMainResume);
const mockedReadiness = vi.mocked(reviewGeneratedMainResumeReadiness);

describe("main resume polish proposal route", () => {
  it("applies edited proposal sections instead of rebuilding the default proposal", async () => {
    mockedApply.mockResolvedValueOnce({
      mainResumeVersionId: "22222222-2222-4222-8222-222222222222",
      proposal: {
        editable_sections: [],
        edits: [],
        fact_guard_status: null,
        generated_resume_id: "22222222-2222-4222-8222-222222222222",
        preview_markdown: "## Summary\nEdited opening summary from the user.",
        readiness_review: null,
        readiness_review_id: null,
        source_main_resume_id: "11111111-1111-4111-8111-111111111111",
        summary: "Proposal summary.",
        title: "Resume polish proposal",
      },
      status: "applied",
    });
    mockedFactGuard.mockResolvedValueOnce({ status: "updated" } as never);
    mockedReadiness.mockResolvedValueOnce({ status: "saved" } as never);

    const body = {
      editable_sections: [
        {
          id: "summary",
          label: "Opening summary",
          original_text: "",
          proposed_text: "Edited opening summary from the user.",
          target_heading: "Summary",
        },
      ],
    };
    const response = await POST(
      new Request("http://localhost/api/main-resume/11111111-1111-4111-8111-111111111111/polish-proposal", {
        body: JSON.stringify(body),
        method: "POST",
      }),
      { params: Promise.resolve({ mainResumeId: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(mockedApply).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      { editableSections: body.editable_sections },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        mainResumeVersionId: "22222222-2222-4222-8222-222222222222",
        status: "applied",
      },
    });
  });
});
