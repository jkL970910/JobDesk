import { afterEach, describe, expect, it } from "vitest";

import {
  buildResumeReviewEvidenceInstructions,
  buildResumeReviewInstructions,
  buildResumeReviewRubricInstructions,
  buildResumeReviewScanInstructions,
  reviewResumeWithAi,
} from "../src/ai/resume-review";

describe("resume review AI instructions", () => {
  const originalProviderEnv = {
    JOBDESK_OPENROUTER_API_KEY: process.env.JOBDESK_OPENROUTER_API_KEY,
    JOBDESK_PROVIDER_ENABLED: process.env.JOBDESK_PROVIDER_ENABLED,
  };

  afterEach(() => {
    process.env.JOBDESK_OPENROUTER_API_KEY = originalProviderEnv.JOBDESK_OPENROUTER_API_KEY;
    process.env.JOBDESK_PROVIDER_ENABLED = originalProviderEnv.JOBDESK_PROVIDER_ENABLED;
  });

  it("adapts HR screening review skill to general resumes", () => {
    const instructions = buildResumeReviewInstructions();

    expect(instructions).toContain("skills/hr-screening-review");
    expect(instructions).toContain("general resume review with no target JD");
    expect(instructions).toContain("Do not produce a JD match score");
    expect(instructions).toContain("fairness_check");
    expect(instructions).toContain("Do not rewrite the resume");
    expect(instructions).toContain("Scores above 90 require exceptional quantified impact");
    expect(instructions).toContain("do not return 100 overall");
    expect(instructions).toContain("helpedScore, loweredScore, evidenceQuestions, nextAction, and raiseScore");
    expect(instructions).toContain("loweredScore must explain deductions");
    expect(instructions).toContain("Do not put privacy/public-safe questions under project depth");
  });

  it("splits full resume review into staged provider calls and consolidates the result", async () => {
    process.env.JOBDESK_OPENROUTER_API_KEY = "test-key";
    process.env.JOBDESK_PROVIDER_ENABLED = "true";

    const tasks: string[] = [];
    const stages: string[] = [];
    let calls = 0;
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        tasks.push("scan");
        return new Promise<Response>((_resolve, reject) => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }

      if (calls === 2) {
        tasks.push("scan");
        return jsonResponse({
          ats_notes: ["The target role is visible but could be stronger."],
          strengths: ["Recent engineering experience is visible."],
          ten_second_scan: "Recruiter sees a software engineer with platform work, but strongest impact is not yet front-loaded.",
          weaknesses: ["Highest-impact projects need sharper priority."],
        });
      }
      if (calls === 3) {
        tasks.push("rubric");
        return jsonResponse({
          score: {
            confidence: 0.78,
            overall: 78,
            scope_note: "General resume review without a target JD.",
          },
          rubric: [
            {
              evidenceQuestions: ["Which project best proves platform ownership?"],
              findings: ["Core sections are present."],
              helpedScore: ["Experience and skills are visible."],
              key: "structure",
              label: "Structure",
              loweredScore: ["Target headline can be sharper."],
              maxScore: 100,
              nextAction: "Clarify target headline and strongest role signal.",
              note: "Resume structure is usable.",
              raiseScore: ["Add a clear target headline."],
              score: 78,
            },
          ],
          suggested_edits: ["Move the strongest platform achievement higher."],
        });
      }
      tasks.push("evidence");
      return jsonResponse({
        fairness_check: {
          applied: true,
          note: "No protected or proxy signals were penalized.",
          signals_not_penalized: [],
        },
        missing_evidence_questions: ["Which metrics can verify platform impact?"],
        risk_flags: ["Some claims need stronger source-backed proof."],
      });
    };

    const result = await reviewResumeWithAi({
      fetchFn,
      onStatus: async (stage) => {
        stages.push(stage);
      },
      sourceText: [
        "Jane Doe",
        "Experience",
        "- Built platform workflow used by 3 teams.",
        "Skills: TypeScript, AWS",
      ].join("\n"),
      sourceTitle: "Jane Doe Resume",
    });

    expect(result.stageCount).toBe(3);
    expect(result.retryCount).toBe(1);
    expect(stages).toEqual(["scanning", "scoring", "evidence_review"]);
    expect(tasks).toEqual(["scan", "scan", "rubric", "evidence"]);
    expect(result.data.score.overall).toBe(78);
    expect(result.data.ten_second_scan).toContain("Recruiter sees");
    expect(result.data.missing_evidence_questions).toEqual([
      "Which metrics can verify platform impact?",
    ]);
  });

  it("documents the staged prompt boundaries", () => {
    expect(buildResumeReviewScanInstructions()).toContain("Stage 1 of 3");
    expect(buildResumeReviewRubricInstructions()).toContain("Stage 2 of 3");
    expect(buildResumeReviewEvidenceInstructions()).toContain("Stage 3 of 3");
  });
});

function jsonResponse(output: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify(output),
      usage: {
        input_tokens: 10,
        output_tokens: 12,
        total_tokens: 22,
      },
    }),
    { status: 200 },
  );
}
