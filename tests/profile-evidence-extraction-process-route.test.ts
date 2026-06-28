import { describe, expect, it } from "vitest";

import { handleProfileEvidenceExtractionProcessOnceRequest } from "../src/server/profile-evidence-extraction-process-route";

describe("profile evidence extraction process-once route", () => {
  it("rejects requests when CRON_SECRET is missing", async () => {
    const response = await handleProfileEvidenceExtractionProcessOnceRequest(
      new Request("http://localhost/api/profile-evidence/extract/runs/process-once", {
        method: "POST",
      }),
      async () => ({ status: "empty" as const }),
      {},
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      kind: "cron_secret_missing",
    });
  });

  it("rejects unauthorized requests", async () => {
    const response = await handleProfileEvidenceExtractionProcessOnceRequest(
      new Request("http://localhost/api/profile-evidence/extract/runs/process-once", {
        headers: { Authorization: "Bearer wrong" },
        method: "POST",
      }),
      async () => ({ status: "empty" as const }),
      { CRON_SECRET: "worker-secret" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("returns empty queue result for authorized requests", async () => {
    const response = await handleProfileEvidenceExtractionProcessOnceRequest(
      new Request("http://localhost/api/profile-evidence/extract/runs/process-once", {
        headers: { Authorization: "Bearer worker-secret" },
        method: "GET",
      }),
      async () => ({ status: "empty" as const }),
      { CRON_SECRET: "worker-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        limit: 1,
        processedCount: 0,
        result: { status: "empty" },
      },
    });
  });

  it("returns processed metadata for authorized processing", async () => {
    const response = await handleProfileEvidenceExtractionProcessOnceRequest(
      new Request("http://localhost/api/profile-evidence/extract/runs/process-once", {
        headers: { Authorization: "Bearer worker-secret" },
        method: "POST",
      }),
      async () => ({
        run: buildRunPayload(),
        status: "completed" as const,
      }),
      { CRON_SECRET: "worker-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        limit: 1,
        processedCount: 1,
        result: {
          run: {
            id: "run-test",
            status: "completed",
          },
          status: "completed",
        },
      },
    });
  });
});

function buildRunPayload() {
  return {
    attemptCount: 1,
    canRetry: false,
    completedAt: "2026-06-28T00:00:00.000Z",
    createdAt: "2026-06-28T00:00:00.000Z",
    failedAt: null,
    failureKind: null,
    failureMessage: null,
    id: "run-test",
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
