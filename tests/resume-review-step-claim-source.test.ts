import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("resume review step claim source invariants", () => {
  const source = readFileSync("src/server/resume-review-repository.ts", "utf8");

  it("keeps the global next-step claim gate strict across rubric dimensions", () => {
    const claimNextStart = source.indexOf("async function claimNextResumeReviewStep");
    const claimNextEnd = source.indexOf("async function claimReadyResumeReviewRubricDimensionSteps");
    expect(claimNextStart).toBeGreaterThanOrEqual(0);
    expect(claimNextEnd).toBeGreaterThan(claimNextStart);

    const claimNextSource = source.slice(claimNextStart, claimNextEnd);
    expect(claimNextSource).toContain("AND earlier.sequence <");
    expect(claimNextSource).toContain("AND earlier.status <> 'completed'");
    expect(claimNextSource).not.toContain("earlier.step_kind <> 'synthesize_rubric_dimension'");
  });

  it("only relaxes rubric dimension ordering inside the bounded rubric-dimension batch helper", () => {
    const batchStart = source.indexOf("async function claimReadyResumeReviewRubricDimensionSteps");
    const processStart = source.indexOf("async function processClaimedResumeReviewStep");
    expect(batchStart).toBeGreaterThanOrEqual(0);
    expect(processStart).toBeGreaterThan(batchStart);

    const batchSource = source.slice(batchStart, processStart);
    expect(batchSource).toContain("AND step_kind = 'synthesize_rubric_dimension'");
    expect(batchSource).toContain("AND earlier.step_kind <> 'synthesize_rubric_dimension'");
    expect(batchSource).toContain("LIMIT ${args.limit}");
  });
});
