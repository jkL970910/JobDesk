import { describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/profile-evidence/extract/runs/[runId]/process/route";
import { runProfileEvidenceExtractionWorkerForRun } from "../src/server/profile-evidence-extraction-worker";

vi.mock("../src/server/profile-evidence-extraction-worker", () => ({
  runProfileEvidenceExtractionWorkerForRun: vi.fn(),
}));

const mockedProcessRun = vi.mocked(runProfileEvidenceExtractionWorkerForRun);

describe("profile evidence extraction run-specific process route", () => {
  it("processes the requested run only", async () => {
    mockedProcessRun.mockResolvedValueOnce({
      run: buildRunPayload("run-user-clicked"),
      status: "completed",
    });

    const response = await POST(
      new Request("http://localhost/api/profile-evidence/extract/runs/run-user-clicked/process", {
        method: "POST",
      }),
      { params: Promise.resolve({ runId: "run-user-clicked" }) },
    );

    expect(mockedProcessRun).toHaveBeenCalledWith("run-user-clicked");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        run: {
          id: "run-user-clicked",
        },
        status: "completed",
      },
    });
  });

  it("does not process unavailable or already-running runs", async () => {
    mockedProcessRun.mockResolvedValueOnce({ status: "not_claimable" });

    const response = await POST(
      new Request("http://localhost/api/profile-evidence/extract/runs/run-busy/process", {
        method: "POST",
      }),
      { params: Promise.resolve({ runId: "run-busy" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      kind: "not_claimable",
    });
  });
});

function buildRunPayload(id: string) {
  return {
    attemptCount: 1,
    canRetry: false,
    completedAt: "2026-06-28T00:00:00.000Z",
    createdAt: "2026-06-28T00:00:00.000Z",
    failedAt: null,
    failureKind: null,
    failureMessage: null,
    id,
    result: {},
    resumeSourceVersionId: "resume-source-test",
    retryAfterSeconds: null,
    sourceDocumentId: "source-document-test",
    sourceTitle: "Resume",
    sourceType: "profile-evidence",
    startedAt: "2026-06-28T00:00:00.000Z",
    status: "completed" as const,
    updatedAt: "2026-06-28T00:00:00.000Z",
    workspaceId: "workspace-test",
  };
}
