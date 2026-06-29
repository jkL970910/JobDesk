import { afterEach, describe, expect, it } from "vitest";

import {
  buildResumeReviewEvidenceInstructions,
  buildResumeReviewInstructions,
  buildResumeReviewRubricInstructions,
  buildResumeReviewScanInstructions,
  reviewResumeWithAi,
  segmentResumeReviewSource,
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
    let sectionCalls = 0;
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<{ content?: string }>;
        messages?: Array<{ content?: string }>;
      };
      const userInput = body.input?.[0]?.content ?? body.messages?.at(-1)?.content ?? "";
      if (userInput.includes('"section"')) {
        sectionCalls += 1;
        tasks.push("section");
        expect(userInput).toContain('"section"');
        if (sectionCalls === 1) {
          return new Promise<Response>((_resolve, reject) => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
        return jsonResponse({
          ats_notes: ["The section is readable."],
          confidence: 0.78,
          dimension_signals: [
            {
              dimension: "readability",
              helped: ["Role names are visible."],
              lowered: ["Target headline could be sharper."],
              raise_score: ["Add a target headline."],
            },
          ],
          evidence_questions: ["Which metric proves platform impact?"],
          risk_flags: ["Some claims need stronger source-backed proof."],
          strengths: ["Recent engineering experience is visible."],
          weaknesses: ["Highest-impact projects need sharper priority."],
        });
      }
      if (!tasks.includes("scan")) {
        tasks.push("scan");
        expect(userInput).not.toContain("Built platform workflow used by 3 teams");
        return jsonResponse({
          ats_notes: ["The target role is visible but could be stronger."],
          strengths: ["Recent engineering experience is visible."],
          ten_second_scan: "Recruiter sees a software engineer with platform work, but strongest impact is not yet front-loaded.",
          weaknesses: ["Highest-impact projects need sharper priority."],
        });
      }
      if (!tasks.includes("rubric")) {
        tasks.push("rubric");
        expect(userInput).not.toContain("Built platform workflow used by 3 teams");
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
      expect(userInput).not.toContain("Built platform workflow used by 3 teams");
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

    expect(result.stageCount).toBe(4);
    expect(result.retryCount).toBe(1);
    expect(stages).toEqual(["scanning", "scoring", "evidence_review"]);
    expect(tasks.slice(0, 2)).toEqual(["section", "section"]);
    expect(tasks.slice(-3)).toEqual(["scan", "rubric", "evidence"]);
    expect(result.data.score.overall).toBe(78);
    expect(result.data.ten_second_scan).toContain("Recruiter sees");
    expect(result.data.missing_evidence_questions).toEqual([
      "Which metrics can verify platform impact?",
    ]);
  });

  it("normalizes section assessment shape drift from provider output", async () => {
    process.env.JOBDESK_OPENROUTER_API_KEY = "test-key";
    process.env.JOBDESK_PROVIDER_ENABLED = "true";

    const nonSectionTasks: Array<"scan" | "rubric" | "evidence"> = [];
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<{ content?: string }>;
        messages?: Array<{ content?: string }>;
      };
      const userInput = body.input?.[0]?.content ?? body.messages?.at(-1)?.content ?? "";
      if (userInput.includes('"section"')) {
        return jsonResponse({
          ats_notes: ["Readable section."],
          confidence: "medium",
          dimension_signals: {
            dimension: "readability",
            helped: "Role and employer are clear.",
            lowered: "Impact is not front-loaded.",
            raise_score: "Move strongest metric higher.",
          },
          evidence_questions: "Which metric proves the platform result?",
          risk_flags: [],
          strengths: "Recent engineering role is clear.",
          weaknesses: "Impact evidence needs sharper proof.",
        });
      }
      if (!nonSectionTasks.includes("scan")) {
        nonSectionTasks.push("scan");
        return jsonResponse({
          ats_notes: ["Readable but target headline could be stronger."],
          strengths: ["Recent engineering role is clear."],
          ten_second_scan: "Recruiter sees a software engineer, but strongest evidence is not yet prominent.",
          weaknesses: ["Impact evidence needs sharper proof."],
        });
      }
      if (!nonSectionTasks.includes("rubric")) {
        nonSectionTasks.push("rubric");
        return jsonResponse({
          score: {
            confidence: 0.66,
            overall: 74,
            scope_note: "General resume review without a target JD.",
          },
          rubric: [
            {
              evidenceQuestions: ["Which metric proves the platform result?"],
              findings: ["Role and employer are clear."],
              helpedScore: ["Role and employer are clear."],
              key: "readability",
              label: "Readability",
              loweredScore: ["Impact is not front-loaded."],
              maxScore: 15,
              nextAction: "Move strongest metric higher.",
              note: "Readable, but first-scan impact can improve.",
              raiseScore: ["Move strongest metric higher."],
              score: 10,
            },
          ],
          suggested_edits: ["Move strongest metric higher."],
        });
      }
      nonSectionTasks.push("evidence");
      return jsonResponse({
        fairness_check: {
          applied: true,
          note: "No protected or proxy signals were penalized.",
          signals_not_penalized: [],
        },
        missing_evidence_questions: ["Which metric proves the platform result?"],
        risk_flags: [],
      });
    };

    const result = await reviewResumeWithAi({
      fetchFn,
      sourceText: [
        "Jane Doe",
        "Experience",
        "Software Engineer, Example Co",
        "Built platform workflow.",
      ].join("\n"),
      sourceTitle: "Jane Doe Resume",
    });

    expect(result.data.score.overall).toBe(74);
    expect(result.data.rubric[0]?.helpedScore).toEqual(["Role and employer are clear."]);
  });

  it("ignores dimension signal entries without a dimension name", async () => {
    process.env.JOBDESK_OPENROUTER_API_KEY = "test-key";
    process.env.JOBDESK_PROVIDER_ENABLED = "true";

    const nonSectionTasks: Array<"scan" | "rubric" | "evidence"> = [];
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<{ content?: string }>;
        messages?: Array<{ content?: string }>;
      };
      const userInput = body.input?.[0]?.content ?? body.messages?.at(-1)?.content ?? "";
      if (userInput.includes('"section"')) {
        return jsonResponse({
          ats_notes: ["Readable section."],
          confidence: 0.7,
          dimension_signals: {
            helped: ["The role is clear."],
            lowered: ["The target headline is missing."],
            raise_score: ["Add a target headline."],
          },
          evidence_questions: ["Which metric proves ownership?"],
          risk_flags: [],
          strengths: ["The role is clear."],
          weaknesses: ["The target headline is missing."],
        });
      }
      if (!nonSectionTasks.includes("scan")) {
        nonSectionTasks.push("scan");
        return jsonResponse({
          ats_notes: ["Readable section."],
          strengths: ["The role is clear."],
          ten_second_scan: "Recruiter sees a software engineer profile.",
          weaknesses: ["The target headline is missing."],
        });
      }
      if (!nonSectionTasks.includes("rubric")) {
        nonSectionTasks.push("rubric");
        return jsonResponse({
          score: {
            confidence: 0.7,
            overall: 72,
            scope_note: "General resume review without a target JD.",
          },
          rubric: [
            {
              evidenceQuestions: ["Which metric proves ownership?"],
              findings: ["The target headline is missing."],
              helpedScore: ["The role is clear."],
              key: "structure",
              label: "Structure",
              loweredScore: ["The target headline is missing."],
              maxScore: 20,
              nextAction: "Add a target headline.",
              note: "Core structure is present.",
              raiseScore: ["Add a target headline."],
              score: 14,
            },
          ],
          suggested_edits: ["Add a target headline."],
        });
      }
      nonSectionTasks.push("evidence");
      return jsonResponse({
        fairness_check: {
          applied: true,
          note: "No protected or proxy signals were penalized.",
          signals_not_penalized: [],
        },
        missing_evidence_questions: ["Which metric proves ownership?"],
        risk_flags: [],
      });
    };

    const result = await reviewResumeWithAi({
      fetchFn,
      sourceText: [
        "Jane Doe",
        "Experience",
        "Software Engineer, Example Co",
      ].join("\n"),
      sourceTitle: "Jane Doe Resume",
    });

    expect(result.data.score.overall).toBe(72);
    expect(result.data.missing_evidence_questions).toEqual(["Which metric proves ownership?"]);
  });

  it("documents the staged prompt boundaries", () => {
    expect(buildResumeReviewScanInstructions()).toContain("Stage 1 of 3");
    expect(buildResumeReviewRubricInstructions()).toContain("Stage 2 of 3");
    expect(buildResumeReviewEvidenceInstructions()).toContain("Stage 3 of 3");
  });

  it("segments resume review source into bounded review sections", () => {
    const sections = segmentResumeReviewSource(`
      Jane Doe
      jane@example.com

      Summary
      Software engineer focused on platform systems.

      Experience
      Amazon
      Software Engineer Jan 2022 - Present
      Built station workflow services.

      Projects
      Portfolio Tracker
      Built a personal finance dashboard.

      Skills
      TypeScript, AWS, SQL
    `);

    expect(sections.map((section) => section.kind)).toEqual([
      "profile",
      "summary",
      "work_experience",
      "projects",
      "skills",
    ]);
    expect(sections.every((section) => section.text.length <= 3200)).toBe(true);
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
