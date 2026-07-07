import { describe, expect, it } from "vitest";

import {
  buildResumeCoreLoopVerificationPlan,
  parseResumeCoreLoopVerificationArgs,
  resumeCoreLoopTargetedTests,
} from "../scripts/verify-resume-core-loop";

describe("resume core loop QA verification plan", () => {
  it("keeps the default verification focused on deterministic local checks", () => {
    const plan = buildResumeCoreLoopVerificationPlan();

    expect(plan.map((step) => step.label)).toEqual([
      "Resume Core Loop targeted tests",
      "Typecheck",
      "Production build",
    ]);
    expect(plan.some((step) => step.integration)).toBe(false);
  });

  it("covers the resume core hardening slices with targeted tests", () => {
    expect(Array.from(resumeCoreLoopTargetedTests)).toEqual(
      expect.arrayContaining([
        "tests/cleanup-dirty-source.test.ts",
        "tests/resume-evidence-eligibility.test.ts",
        "tests/evidence-route.test.ts",
        "tests/evidence-quarantine-route.test.ts",
        "tests/resume-readiness-worklist.test.ts",
        "tests/resume-export.test.ts",
        "tests/tailored-resume-export-route.test.ts",
        "tests/retrieval-service.test.ts",
        "tests/resume-review-run-routes.test.ts",
      ]),
    );
  });

  it("adds the database suite only when explicitly requested", () => {
    const plan = buildResumeCoreLoopVerificationPlan({ includeIntegration: true });

    expect(plan.at(-1)).toMatchObject({
      args: ["run", "test:integration"],
      command: "npm",
      integration: true,
      label: "Database integration tests",
    });
  });

  it("parses integration and list-only flags", () => {
    expect(parseResumeCoreLoopVerificationArgs(["--integration", "--list"])).toEqual({
      includeIntegration: true,
      listOnly: true,
    });
  });
});
