import { describe, expect, it, vi } from "vitest";

import { POST as uploadPost } from "../app/api/resume-review/route";
import { DELETE, GET, PATCH } from "../app/api/resume-review/[resumeSourceVersionId]/route";
import { POST as rerunPost } from "../app/api/resume-review/[resumeSourceVersionId]/rerun/route";
import { POST as processPost } from "../app/api/resume-review/runs/[runId]/process/route";
import { GET as runGet } from "../app/api/resume-review/runs/[runId]/route";
import { parseResumeSourceFile } from "../src/server/resume-source-parser";
import {
  createResumeSourceVersion,
  deleteResumeSourceVersion,
  getResumeSourceDeleteImpact,
  getResumeReviewRun,
  processResumeReviewRun,
  startResumeReviewRun,
} from "../src/server/resume-review-repository";

vi.mock("../src/server/resume-source-parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/resume-source-parser")>();
  return {
    ...actual,
    parseResumeSourceFile: vi.fn(),
  };
});

vi.mock("../src/server/resume-review-repository", () => ({
  createResumeSourceVersion: vi.fn(),
  deleteResumeSourceVersion: vi.fn(),
  getResumeReviewRun: vi.fn(),
  getResumeSourceDeleteImpact: vi.fn(),
  getResumeSourceVersion: vi.fn(),
  processResumeReviewRun: vi.fn(),
  startResumeReviewRun: vi.fn(),
}));

const mockedCreateResumeSourceVersion = vi.mocked(createResumeSourceVersion);
const mockedDeleteResumeSourceVersion = vi.mocked(deleteResumeSourceVersion);
const mockedGetDeleteImpact = vi.mocked(getResumeSourceDeleteImpact);
const mockedGetRun = vi.mocked(getResumeReviewRun);
const mockedParseResumeSourceFile = vi.mocked(parseResumeSourceFile);
const mockedProcessRun = vi.mocked(processResumeReviewRun);
const mockedStartRun = vi.mocked(startResumeReviewRun);

describe("resume review run routes", () => {
  it("saves an uploaded resume and returns a durable review run before processing", async () => {
    mockedParseResumeSourceFile.mockResolvedValueOnce({
      parseAttempts: [],
      parseQuality: {
        charCount: 31,
        status: "usable",
        warnings: [],
        wordCount: 5,
      },
      fileSizeBytes: 6,
      mimeType: "text/plain",
      originalFilename: "resume.txt",
      parserName: "jobdesk-source-parser",
      parserVersion: "document-lifecycle-v1",
      sourceKind: "text",
      sourceText: "Jiekun Liu\nBuilt product systems.",
      sourceTitle: "Jiekun Liu Resume.txt",
      warnings: [],
    });
    mockedCreateResumeSourceVersion.mockResolvedValueOnce({
      resume: buildResumePayload({
        activeReviewRun: buildReviewRunPayload({ id: "run-upload" }),
        status: "uploaded",
      }),
      run: buildReviewRunPayload({ id: "run-upload" }),
      status: "saved",
    });

    const formData = new FormData();
    formData.append("file", new File(["resume"], "resume.txt", { type: "text/plain" }));
    const response = await uploadPost(
      new Request("http://localhost/api/resume-review", {
        body: formData,
        method: "POST",
      }),
    );

    expect(mockedCreateResumeSourceVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: "Jiekun Liu\nBuilt product systems.",
        sourceTitle: "Jiekun Liu Resume.txt",
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        resume: {
          activeReviewRun: {
            id: "run-upload",
            stage: "queued",
            status: "running",
          },
          latestReview: null,
          status: "uploaded",
        },
        run: {
          id: "run-upload",
          stage: "queued",
          status: "running",
        },
        status: "saved",
      },
    });
  });

  it("returns in-progress review state for duplicate uploads", async () => {
    mockedParseResumeSourceFile.mockResolvedValueOnce({
      parseAttempts: [],
      parseQuality: {
        charCount: 31,
        status: "usable",
        warnings: [],
        wordCount: 5,
      },
      fileSizeBytes: 6,
      mimeType: "text/plain",
      originalFilename: "resume.txt",
      parserName: "jobdesk-source-parser",
      parserVersion: "document-lifecycle-v1",
      sourceKind: "text",
      sourceText: "Jiekun Liu\nBuilt product systems.",
      sourceTitle: "Jiekun Liu Resume.txt",
      warnings: [],
    });
    mockedCreateResumeSourceVersion.mockResolvedValueOnce({
      existingResume: buildResumePayload({
        activeReviewRun: buildReviewRunPayload({ id: "run-existing", stage: "scanning" }),
        latestReview: null,
        status: "uploaded",
      }),
      status: "duplicate",
    });

    const formData = new FormData();
    formData.append("file", new File(["resume"], "resume.txt", { type: "text/plain" }));
    const response = await uploadPost(
      new Request("http://localhost/api/resume-review", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        existingResume: {
          activeReviewRun: {
            id: "run-existing",
            stage: "scanning",
            status: "running",
          },
          latestReview: null,
          status: "uploaded",
        },
        status: "duplicate",
      },
    });
  });


  it("starts a durable review run from the retry route", async () => {
    mockedStartRun.mockResolvedValueOnce({
      resume: buildResumePayload({ activeReviewRun: buildReviewRunPayload({ id: "run-retry" }) }),
      run: buildReviewRunPayload({ id: "run-retry" }),
      status: "created",
    });

    const response = await rerunPost(
      new Request("http://localhost/api/resume-review/resume-1/rerun", { method: "POST" }),
      { params: Promise.resolve({ resumeSourceVersionId: "resume-1" }) },
    );

    expect(mockedStartRun).toHaveBeenCalledWith("resume-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        run: {
          id: "run-retry",
          stage: "queued",
          status: "running",
        },
        status: "created",
      },
    });
  });

  it("keeps legacy rerun PATCH on the same async start path", async () => {
    mockedStartRun.mockResolvedValueOnce({
      resume: buildResumePayload({ activeReviewRun: buildReviewRunPayload({ id: "run-patch" }) }),
      run: buildReviewRunPayload({ id: "run-patch" }),
      status: "created",
    });

    const response = await PATCH(
      new Request("http://localhost/api/resume-review/resume-1", {
        body: JSON.stringify({ action: "rerun_review" }),
        method: "PATCH",
      }),
      { params: Promise.resolve({ resumeSourceVersionId: "resume-1" }) },
    );

    expect(mockedStartRun).toHaveBeenCalledWith("resume-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        run: {
          id: "run-patch",
        },
        status: "created",
      },
    });
  });

  it("previews delete impact for a resume source", async () => {
    mockedGetDeleteImpact.mockResolvedValueOnce({
      impact: {
        draftEvidenceItems: 2,
        draftInitiatives: 1,
        draftPortfolioProjects: 0,
        draftWorkExperiences: 3,
        openEnrichmentTasks: 4,
        orphanSourceSectionTasks: 0,
        profileRows: 0,
      },
      resume: buildResumePayload(),
      status: "ready",
    });

    const response = await GET(
      new Request("http://localhost/api/resume-review/resume-1?includeDeleteImpact=1"),
      { params: Promise.resolve({ resumeSourceVersionId: "resume-1" }) },
    );

    expect(mockedGetDeleteImpact).toHaveBeenCalledWith("resume-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        impact: {
          draftEvidenceItems: 2,
          openEnrichmentTasks: 4,
        },
        status: "ready",
      },
    });
  });

  it("deletes a resume source while keeping library materials by default", async () => {
    mockedDeleteResumeSourceVersion.mockResolvedValueOnce({
      cleanupMode: "keep_library",
      deletedCounts: {
        draftEvidenceItems: 0,
        draftInitiatives: 0,
        draftPortfolioProjects: 0,
        draftWorkExperiences: 0,
        openEnrichmentTasks: 0,
        orphanSourceSectionTasks: 0,
        profileRows: 0,
        sourceDocumentDeleted: false,
      },
      impact: {
        draftEvidenceItems: 1,
        draftInitiatives: 0,
        draftPortfolioProjects: 0,
        draftWorkExperiences: 1,
        openEnrichmentTasks: 1,
        orphanSourceSectionTasks: 0,
        profileRows: 0,
      },
      resume: buildResumePayload(),
      status: "deleted",
    });

    const response = await DELETE(
      new Request("http://localhost/api/resume-review/resume-1", {
        body: JSON.stringify({ cleanupMode: "keep_library" }),
        method: "DELETE",
      }),
      { params: Promise.resolve({ resumeSourceVersionId: "resume-1" }) },
    );

    expect(mockedDeleteResumeSourceVersion).toHaveBeenCalledWith("resume-1", {
      cleanupMode: "keep_library",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        cleanupMode: "keep_library",
        status: "deleted",
      },
    });
  });

  it("passes draft material cleanup mode to resume source deletion", async () => {
    mockedDeleteResumeSourceVersion.mockResolvedValueOnce({
      cleanupMode: "remove_draft_materials",
      deletedCounts: {
        draftEvidenceItems: 1,
        draftInitiatives: 1,
        draftPortfolioProjects: 0,
        draftWorkExperiences: 2,
        openEnrichmentTasks: 3,
        orphanSourceSectionTasks: 0,
        profileRows: 1,
        sourceDocumentDeleted: true,
      },
      impact: {
        draftEvidenceItems: 1,
        draftInitiatives: 1,
        draftPortfolioProjects: 0,
        draftWorkExperiences: 2,
        openEnrichmentTasks: 3,
        orphanSourceSectionTasks: 0,
        profileRows: 1,
      },
      resume: buildResumePayload(),
      status: "deleted",
    });

    const response = await DELETE(
      new Request("http://localhost/api/resume-review/resume-1", {
        body: JSON.stringify({ cleanupMode: "remove_draft_materials" }),
        method: "DELETE",
      }),
      { params: Promise.resolve({ resumeSourceVersionId: "resume-1" }) },
    );

    expect(mockedDeleteResumeSourceVersion).toHaveBeenCalledWith("resume-1", {
      cleanupMode: "remove_draft_materials",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        cleanupMode: "remove_draft_materials",
        deletedCounts: {
          openEnrichmentTasks: 3,
          sourceDocumentDeleted: true,
        },
      },
    });
  });

  it("returns the persisted run for polling", async () => {
    mockedGetRun.mockResolvedValueOnce({
      run: buildReviewRunPayload({
        id: "run-poll",
        stage: "scanning",
        stepProgress: {
          completedSteps: 3,
          currentStepTitle: "Review Work Experience",
          failedSteps: 0,
          processingSteps: 1,
          sectionCompleted: 2,
          sectionTotal: 6,
          totalSteps: 7,
        },
      }),
      status: "ready",
    });

    const response = await runGet(
      new Request("http://localhost/api/resume-review/runs/run-poll"),
      { params: Promise.resolve({ runId: "run-poll" }) },
    );

    expect(mockedGetRun).toHaveBeenCalledWith("run-poll");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        run: {
          id: "run-poll",
          stage: "scanning",
          stepProgress: {
            currentStepTitle: "Review Work Experience",
            sectionCompleted: 2,
            sectionTotal: 6,
          },
          status: "running",
        },
        status: "ready",
      },
    });
  });

  it("processes a user-triggered review run", async () => {
    mockedProcessRun.mockResolvedValueOnce({
      resume: buildResumePayload(),
      run: buildReviewRunPayload({
        finishedAt: "2026-06-28T12:02:00.000Z",
        id: "run-process",
        stage: "completed",
        status: "succeeded",
      }),
      status: "saved",
    });

    const response = await processPost(
      new Request("http://localhost/api/resume-review/runs/run-process/process", { method: "POST" }),
      { params: Promise.resolve({ runId: "run-process" }) },
    );

    expect(mockedProcessRun).toHaveBeenCalledWith("run-process");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        run: {
          id: "run-process",
          stage: "completed",
          status: "succeeded",
        },
        status: "saved",
      },
    });
  });

  it("returns hasMoreWork while a review run still has pending steps", async () => {
    mockedProcessRun.mockResolvedValueOnce({
      hasMoreWork: true,
      run: buildReviewRunPayload({
        id: "run-step",
        stage: "scanning",
        status: "running",
      }),
      status: "ready",
    });

    const response = await processPost(
      new Request("http://localhost/api/resume-review/runs/run-step/process", { method: "POST" }),
      { params: Promise.resolve({ runId: "run-step" }) },
    );

    expect(mockedProcessRun).toHaveBeenCalledWith("run-step");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        hasMoreWork: true,
        run: {
          id: "run-step",
          stage: "scanning",
          status: "running",
        },
        status: "ready",
      },
    });
  });

  it("returns not_found for unavailable review runs", async () => {
    mockedGetRun.mockResolvedValueOnce({ status: "not_found" });

    const response = await runGet(
      new Request("http://localhost/api/resume-review/runs/missing"),
      { params: Promise.resolve({ runId: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      kind: "not_found",
    });
  });
});

function buildReviewRunPayload(overrides: Partial<ReviewRunPayload> = {}): ReviewRunPayload {
  return {
    errorKind: null,
    errorMessage: null,
    finishedAt: null,
    id: "run-test",
    stage: "queued",
    startedAt: "2026-06-28T12:00:00.000Z",
    status: "running",
    ...overrides,
  };
}

function buildResumePayload(
  overrides: Partial<ResumePayload> = {},
): ResumePayload {
  return {
    activeReviewRun: null,
    contentHash: "hash-test",
    createdAt: "2026-06-28T12:00:00.000Z",
    extractedAt: null,
    id: "resume-1",
    lastReviewedAt: null,
    latestReview: null,
    sourceDocumentId: "source-document-1",
    sourceKind: "resume",
    sourceText: "Resume text",
    status: "reviewed",
    title: "Jiekun Liu Resume.pdf",
    updatedAt: "2026-06-28T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

type ReviewRunPayload = {
  errorKind: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  stage:
    | "queued"
    | "reading_source"
    | "scanning"
    | "scoring"
    | "evidence_review"
    | "analyzing"
    | "validating"
    | "saving"
    | "completed"
    | "failed";
  startedAt: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  stepProgress?: {
    currentStepTitle: string | null;
    completedSteps: number;
    failedSteps: number;
    processingSteps: number;
    sectionCompleted: number;
    sectionTotal: number;
    totalSteps: number;
  } | null;
};

type ResumePayload = {
  activeReviewRun: ReviewRunPayload | null;
  contentHash: string;
  createdAt: string;
  extractedAt: string | null;
  id: string;
  lastReviewedAt: string | null;
  latestReview: {
    createdAt: string;
    id: string;
    missingEvidenceQuestions: string[];
    overallScore: number;
    recommendedActions: string[];
    riskFlags: string[];
    rubric: Record<string, unknown>[];
    status: "ready" | "stale";
    strengths: string[];
    updatedAt: string;
    weaknesses: string[];
  } | null;
  sourceDocumentId: string;
  sourceKind: string;
  sourceText: string;
  status: "archived" | "extracted" | "reviewed" | "uploaded";
  title: string;
  updatedAt: string;
  version: number;
};
