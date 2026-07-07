import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/evidence/[evidenceId]/quarantine/route";
import { quarantineEvidenceAsset } from "../src/server/evidence-asset-actions";

vi.mock("../src/server/embedding-service", () => ({
  schedulePersonalEmbeddingsSync: vi.fn(),
}));

vi.mock("../src/server/evidence-asset-actions", () => ({
  quarantineEvidenceAsset: vi.fn(),
}));

const mockedQuarantineEvidenceAsset = vi.mocked(quarantineEvidenceAsset);

describe("evidence quarantine route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("quarantines a protected evidence item by id", async () => {
    mockedQuarantineEvidenceAsset.mockResolvedValueOnce({
      cleanupEventId: "22222222-2222-4222-8222-222222222222",
      evidenceItem: {
        allowedUsage: [],
        id: "11111111-1111-4111-8111-111111111111",
        needsUserConfirmation: true,
        quarantineReason: "Bad import reset.",
        quarantinedAt: "2026-07-07T00:00:00.000Z",
        status: "rejected",
      },
      staleGeneratedClaims: 2,
      status: "saved",
    });

    const response = await POST(
      new Request("http://localhost/api/evidence/11111111-1111-4111-8111-111111111111/quarantine", {
        body: JSON.stringify({
          confirmation: "QUARANTINE_APPROVED_EVIDENCE",
          reason: "Bad import reset.",
        }),
        method: "POST",
      }),
      {
        params: Promise.resolve({ evidenceId: "11111111-1111-4111-8111-111111111111" }),
      },
    );

    expect(mockedQuarantineEvidenceAsset).toHaveBeenCalledWith({
      confirmation: "QUARANTINE_APPROVED_EVIDENCE",
      evidenceId: "11111111-1111-4111-8111-111111111111",
      reason: "Bad import reset.",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        staleGeneratedClaims: 2,
        status: "saved",
      },
    });
  });

  it("returns conflict when quarantine confirmation is missing", async () => {
    mockedQuarantineEvidenceAsset.mockResolvedValueOnce({
      reason: "quarantine_confirmation_required",
      status: "invalid",
    });

    const response = await POST(
      new Request("http://localhost/api/evidence/33333333-3333-4333-8333-333333333333/quarantine", {
        body: JSON.stringify({ confirmation: "wrong" }),
        method: "POST",
      }),
      {
        params: Promise.resolve({ evidenceId: "33333333-3333-4333-8333-333333333333" }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "quarantine_confirmation_required",
      kind: "invalid_evidence_quarantine",
    });
  });

  it("rejects invalid evidence ids", async () => {
    const response = await POST(
      new Request("http://localhost/api/evidence/not-a-uuid/quarantine", {
        body: JSON.stringify({ confirmation: "QUARANTINE_APPROVED_EVIDENCE" }),
        method: "POST",
      }),
      {
        params: Promise.resolve({ evidenceId: "not-a-uuid" }),
      },
    );

    expect(mockedQuarantineEvidenceAsset).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });
});
