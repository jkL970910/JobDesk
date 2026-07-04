import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE } from "../app/api/evidence/[evidenceId]/route";
import { deleteEvidenceItem } from "../src/server/profile-evidence-repository";

vi.mock("../src/server/embedding-service", () => ({
  schedulePersonalEmbeddingsSync: vi.fn(),
}));

vi.mock("../src/server/profile-evidence-repository", () => ({
  deleteEvidenceItem: vi.fn(),
  updateEvidenceItem: vi.fn(),
}));

const mockedDeleteEvidenceItem = vi.mocked(deleteEvidenceItem);

describe("evidence item route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes an evidence item by id", async () => {
    mockedDeleteEvidenceItem.mockResolvedValueOnce({
      deletedEnrichmentTaskTargets: 1,
      deletedEnrichmentTasks: 2,
      deletedEvidenceItemId: "11111111-1111-4111-8111-111111111111",
      staleGeneratedClaims: 1,
      status: "deleted",
    });

    const response = await DELETE(new Request("http://localhost/api/evidence/evidence-1"), {
      params: Promise.resolve({ evidenceId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(mockedDeleteEvidenceItem).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deletedEvidenceItemId: "11111111-1111-4111-8111-111111111111",
        staleGeneratedClaims: 1,
        status: "deleted",
      },
    });
  });

  it("rejects invalid evidence ids", async () => {
    const response = await DELETE(new Request("http://localhost/api/evidence/not-a-uuid"), {
      params: Promise.resolve({ evidenceId: "not-a-uuid" }),
    });

    expect(mockedDeleteEvidenceItem).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it("returns not found when the evidence item is missing", async () => {
    mockedDeleteEvidenceItem.mockResolvedValueOnce({ status: "not_found" });

    const response = await DELETE(new Request("http://localhost/api/evidence/evidence-1"), {
      params: Promise.resolve({ evidenceId: "22222222-2222-4222-8222-222222222222" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      kind: "not_found",
    });
  });
});
