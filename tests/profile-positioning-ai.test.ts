import { beforeEach, describe, expect, it } from "vitest";

import { generateMainResumeWithAi } from "../src/ai/main-resume";
import { generateProfilePositioningWithAi } from "../src/ai/profile-positioning";
import { buildDirection } from "./support/profile-positioning-fixtures";

describe("profile positioning AI workflows", () => {
  beforeEach(() => {
    process.env.JOBDESK_OPENROUTER_API_KEY = "test-key";
    process.env.JOBDESK_OPENROUTER_TRANSPORT = "responses";
    process.env.JOBDESK_OPENROUTER_BASE_URL = "https://openrouter.icu";
    process.env.JOBDESK_PROVIDER_ENABLED = "true";
    process.env.JOBDESK_DISABLE_RESPONSE_STORAGE = "true";
  });

  it("generates a profile positioning report through the registered skill", async () => {
    const fetchCalls: Array<{ init?: RequestInit }> = [];
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ init });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            summary: "Data/product positioning has the strongest evidence support.",
            generated_at: new Date().toISOString(),
            directions: [buildDirection("evidence-1")],
            global_strengths: ["Analytics execution"],
            global_gaps: ["Product strategy scope"],
          }),
        }),
        { status: 200 },
      );
    };

    const result = await generateProfilePositioningWithAi({
      profile: { name: { value: "Jane Doe" } },
      evidenceItems: [
        {
          id: "evidence-1",
          text: "Built activation funnel dashboard.",
          source_quote: "Built activation funnel dashboard.",
          metrics: [],
          sensitivity_level: "public_safe",
          public_safe_summary: null,
        },
      ],
      fetchFn,
    });

    expect(result.skill.skillId).toBe("profile-positioning");
    expect(result.data.directions[0]?.supporting_evidence[0]?.evidence_id).toBe(
      "evidence-1",
    );
    const body = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(JSON.stringify(body)).toContain("skill_id=profile-positioning");
  });

  it("injects selected positioning direction into main resume generation", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            title: "Data Product Manager resume",
            resume_json: {},
            resume_markdown: "## Experience\n- Built activation funnel dashboard.",
            claims: [
              {
                claim_text: "Built activation funnel dashboard.",
                section: "Experience",
                evidence_ids: ["evidence-1"],
                source_quotes: ["Built activation funnel dashboard."],
                risk_level: "low",
              },
            ],
            missing_evidence_questions: [],
          }),
        }),
        { status: 200 },
      );
    };

    await generateMainResumeWithAi({
      profile: { name: { value: "Jane Doe" } },
      evidenceItems: [
        {
          id: "evidence-1",
          text: "Built activation funnel dashboard.",
          source_quote: "Built activation funnel dashboard.",
          metrics: [],
          sensitivity_level: "public_safe",
          public_safe_summary: null,
        },
      ],
      positioningDirection: buildDirection("evidence-1"),
      fetchFn,
    });

    const request = JSON.stringify(bodies[0]);
    expect(request).toContain("positioning_direction");
    expect(request).toContain("Data Product Manager");
    expect(request).toContain("Generate a general-purpose recruiter/networking resume");
  });
});
