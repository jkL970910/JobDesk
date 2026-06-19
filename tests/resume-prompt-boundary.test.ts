import { describe, expect, it } from "vitest";

import { buildMainResumeInstructions } from "../src/ai/main-resume";
import { buildTailoredResumeInstructions } from "../src/ai/tailored-resume";

describe("resume prompt retrieval boundary", () => {
  it("keeps raw source chunks out of main and tailored resume prompts", () => {
    const main = buildMainResumeInstructions();
    const tailored = buildTailoredResumeInstructions();

    expect(main).toContain("approved_resume_evidence");
    expect(tailored).toContain("approved_resume_evidence");
    expect(main).not.toMatch(/source[_ -]?chunk/i);
    expect(tailored).not.toMatch(/source[_ -]?chunk/i);
    expect(main).not.toContain("possible_source_material");
    expect(tailored).not.toContain("possible_source_material");
  });
});
