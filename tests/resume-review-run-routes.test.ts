import { describe, expect, it, vi } from "vitest";

import { POST as uploadPost } from "../app/api/resume-review/route";
import { PATCH } from "../app/api/resume-review/[resumeSourceVersionId]/route";
import { POST as rerunPost } from "../app/api/resume-review/[resumeSourceVersionId]/rerun/route";
import { POST as processPost } from "../app/api/resume-review/runs/[runId]/process/route";
import { GET as runGet } from "../app/api/resume-review/runs/[runId]/route";
import { parseResumeSourceFile } from "../src/server/resume-source-parser";
import {
  createResumeSourceVersion,
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
  getResumeSourceVersion: vi.fn(),
  processResumeReviewRun: vi.fn(),
  startResumeReviewRun: vi.fn(),
}));

const mockedCreateResumeSourceVersion = vi.mocked(createResumeSourceVersion);
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

  it("returns the persisted run for polling", async () => {
    mockedGetRun.mockResolvedValueOnce({
      run: buildReviewRunPayload({ id: "run-poll", stage: "analyzing" }),
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
          stage: "analyzing",
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
