import { describe, expect, it } from "vitest";

import {
  assertActiveJdAnalysis,
  JobRepositoryError,
  persistJdAnalysis,
  persistJdAnalysisFailure,
} from "../src/server/job-repository";

describe("job repository", () => {
  it("skips persistence when DATABASE_URL is not configured", async () => {
    const oldDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const result = await persistJdAnalysis({
      analysis: {
        job_id: "job-1",
        original_jd_text: "Requires SQL.",
        job_facts: {
          company: null,
          role_title: "Data Analyst",
          level: null,
          location: null,
          responsibilities: [],
          preferred_qualifications: [],
        },
        role_archetype: "technical_ai_pm",
        job_legitimacy: {
          tier: "proceed_with_caution",
          signals: [],
          context_notes: [],
        },
        requirements: [],
        role_signals: [],
        keywords: [],
        interview_implications: [],
      },
      provider: "test",
      model: "gpt-5.5",
      usage: {},
      retryCount: 0,
    });

    if (oldDatabaseUrl == null) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = oldDatabaseUrl;
    }

    expect(result).toEqual({
      status: "skipped",
      reason: "missing_database_url",
    });
  });

  it("skips failure persistence when DATABASE_URL is not configured", async () => {
    const oldDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const result = await persistJdAnalysisFailure({
      provider: "test",
      model: "gpt-5.5",
      errorKind: "provider_5xx",
      errorMessage: "Provider failed.",
      retryCount: 1,
    });

    if (oldDatabaseUrl == null) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = oldDatabaseUrl;
    }

    expect(result).toEqual({
      status: "skipped",
      reason: "missing_database_url",
    });
  });

  it("skips active job assertions when DATABASE_URL is not configured", async () => {
    const oldDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    await expect(
      assertActiveJdAnalysis("00000000-0000-4000-8000-000000000000"),
    ).resolves.toBeUndefined();

    if (oldDatabaseUrl == null) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = oldDatabaseUrl;
    }
  });

  it("uses a typed repository error for missing jobs", () => {
    const error = new JobRepositoryError("Missing.", { kind: "job_not_found" });
    expect(error.kind).toBe("job_not_found");
  });
});
