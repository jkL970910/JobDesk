import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/resumes/[resumeId]/export/route";
import { getTailoredResumeById } from "../src/server/resume-repository";

vi.mock("../src/server/resume-repository", () => ({
  getTailoredResumeById: vi.fn(),
}));

const mockedGetTailoredResumeById = vi.mocked(getTailoredResumeById);
const resumeId = "11111111-1111-4111-8111-111111111111";

describe("tailored resume export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports validated tailored resumes as printable HTML", async () => {
    mockedGetTailoredResumeById.mockResolvedValueOnce(
      tailoredResume({ status: "validated" }) as never,
    );

    const response = await GET(
      new Request(`http://localhost/api/resumes/${resumeId}/export?format=html&pagePolicy=one_page`),
      { params: Promise.resolve({ resumeId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="senior-analyst-tailored-resume.html"',
    );
    expect(response.headers.get("x-resume-export-page-policy")).toBe("one_page");
    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Senior Analyst Tailored Resume");
    expect(html).toContain("Built SQL dashboards for onboarding funnel analysis.");
  });

  it("exports validated tailored resumes as DOCX", async () => {
    mockedGetTailoredResumeById.mockResolvedValueOnce(
      tailoredResume({ status: "validated" }) as never,
    );

    const response = await GET(
      new Request(`http://localhost/api/resumes/${resumeId}/export?format=docx`),
      { params: Promise.resolve({ resumeId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="senior-analyst-tailored-resume.docx"',
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 2).toString()).toBe("PK");
  });

  it("blocks final tailored resume exports until Fact Guard validates the draft", async () => {
    mockedGetTailoredResumeById.mockResolvedValueOnce(
      tailoredResume({ status: "unvalidated" }) as never,
    );

    const response = await GET(
      new Request(`http://localhost/api/resumes/${resumeId}/export?format=html`),
      { params: Promise.resolve({ resumeId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "resume_not_validated",
    });
  });

  it("keeps JSON audit export available before final validation", async () => {
    mockedGetTailoredResumeById.mockResolvedValueOnce(
      tailoredResume({ status: "unvalidated" }) as never,
    );

    const response = await GET(
      new Request(`http://localhost/api/resumes/${resumeId}/export?format=json`),
      { params: Promise.resolve({ resumeId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    await expect(response.json()).resolves.toMatchObject({
      id: resumeId,
      status: "unvalidated",
    });
  });
});

function tailoredResume(patch: { status: string }) {
  return {
    claims: [],
    id: resumeId,
    jobId: "22222222-2222-4222-8222-222222222222",
    missing_evidence_questions: [],
    readiness_review: null,
    readiness_worklist: {
      items: [],
      summary: {
        blockerCount: 0,
        infoCount: 0,
        nextAction: null,
        readyForFinalExport: patch.status === "validated",
        warningCount: 0,
      },
    },
    resume_json: {
      sections: [
        {
          bullets: ["Built SQL dashboards for onboarding funnel analysis."],
          title: "Experience",
        },
      ],
    },
    resume_markdown: "## Experience\n- Built SQL dashboards for onboarding funnel analysis.",
    status: patch.status,
    title: "Senior Analyst Tailored Resume",
    updatedAt: "2026-07-07T12:00:00.000Z",
    version: 1,
  };
}
