import { describe, expect, it } from "vitest";

import {
  collectProtectedWorkExperienceIds,
  draftAssetIds,
  isProtectedEvidence,
  protectedAssetIds,
  summarizeEvidence,
} from "../scripts/cleanup-dirty-source";

describe("cleanup dirty source safety policy", () => {
  it("protects approved and resume-allowed evidence from default cleanup", () => {
    const rows = [
      {
        allowed_usage: ["interview"],
        id: "draft",
        status: "pending",
      },
      {
        allowed_usage: ["interview"],
        id: "approved",
        status: "approved",
      },
      {
        allowed_usage: ["resume"],
        id: "resume-ready",
        status: "pending",
      },
    ];

    expect(rows.map(isProtectedEvidence)).toEqual([false, true, true]);
    expect(summarizeEvidence(rows)).toMatchObject({
      approved: 1,
      draftDeletedByDefault: 1,
      protectedByDefault: 2,
      resumeReady: 1,
      total: 3,
    });
  });

  it("protects parent work experiences for protected initiative evidence", () => {
    expect(
      collectProtectedWorkExperienceIds({
        directWorkExperienceIds: ["work-direct"],
        initiativeParentWorkExperienceIds: ["work-parent", "work-direct"],
      }),
    ).toEqual(["work-direct", "work-parent"]);
  });

  it("protects approved non-evidence assets from default cleanup", () => {
    const rows = [
      { id: "draft-work", status: "pending" },
      { id: "approved-work", status: "approved" },
      { id: "rejected-work", status: "rejected" },
    ];
    const protectedIds = protectedAssetIds(rows);

    expect(protectedIds).toEqual(["approved-work"]);
    expect(draftAssetIds(rows, protectedIds)).toEqual(["draft-work", "rejected-work"]);
  });

  it("protects child initiatives when a parent work experience is protected", () => {
    const initiativeRows = [
      { id: "child-of-approved-work", status: "pending", work_experience_id: "approved-work" },
      { id: "standalone-draft", status: "pending", work_experience_id: null },
      { id: "approved-initiative", status: "approved", work_experience_id: "draft-work" },
    ];
    const protectedWorkExperienceIds = ["approved-work"];
    const protectedInitiativeIds = protectedAssetIds(initiativeRows);
    const childInitiativeIds = initiativeRows
      .filter(
        (row) =>
          typeof row.work_experience_id === "string" &&
          protectedWorkExperienceIds.includes(row.work_experience_id),
      )
      .map((row) => String(row.id));
    const allProtectedInitiativeIds = Array.from(
      new Set([...protectedInitiativeIds, ...childInitiativeIds]),
    );

    expect(allProtectedInitiativeIds).toEqual([
      "approved-initiative",
      "child-of-approved-work",
    ]);
    expect(draftAssetIds(initiativeRows, allProtectedInitiativeIds)).toEqual(["standalone-draft"]);
  });
});
