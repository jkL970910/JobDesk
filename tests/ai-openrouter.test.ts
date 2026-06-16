import { describe, expect, it } from "vitest";

import {
  normalizeOpenRouterChatCompletionsEndpoint,
  normalizeOpenRouterResponsesEndpoint,
} from "../src/ai/config";
import { JobDeskAiError } from "../src/ai/errors";
import { buildJdAnalysisInstructions } from "../src/ai/jd-analysis";
import { OpenRouterResponsesAdapter } from "../src/ai/openrouter-adapter";
import { extractOutputText, parseJsonObject } from "../src/ai/output-parser";
import { skillRegistry } from "../src/ai/skills-registry";
import { JDAnalysis } from "../src/schemas/jd-analysis";

describe("OpenRouter endpoint normalization", () => {
  it("normalizes common base URL forms to Responses endpoints", () => {
    expect(normalizeOpenRouterResponsesEndpoint("https://openrouter.icu")).toBe(
      "https://openrouter.icu/v1/responses",
    );
    expect(normalizeOpenRouterResponsesEndpoint("https://openrouter.icu/v1")).toBe(
      "https://openrouter.icu/v1/responses",
    );
    expect(normalizeOpenRouterResponsesEndpoint("https://openrouter.ai")).toBe(
      "https://openrouter.ai/api/v1/responses",
    );
  });

  it("normalizes common base URL forms to chat-completions endpoints", () => {
    expect(
      normalizeOpenRouterChatCompletionsEndpoint("https://openrouter.icu/v1/responses"),
    ).toBe("https://openrouter.icu/v1/chat/completions");
    expect(normalizeOpenRouterChatCompletionsEndpoint("https://openrouter.icu")).toBe(
      "https://openrouter.icu/v1/chat/completions",
    );
  });
});

describe("AI output parser", () => {
  it("extracts text from Responses and chat-completions style payloads", () => {
    expect(extractOutputText({ output_text: "direct" })).toBe("direct");
    expect(
      extractOutputText({
        choices: [{ message: { content: "{\"ok\":true}" } }],
      }),
    ).toBe("{\"ok\":true}");
  });

  it("parses fenced and wrapped JSON objects", () => {
    expect(parseJsonObject("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
    expect(parseJsonObject("prefix {\"ok\":true} suffix")).toEqual({ ok: true });
  });
});

describe("OpenRouterResponsesAdapter", () => {
  it("sends a structured Responses request and validates JDAnalysis output", async () => {
    const fetchCalls: Array<{ url: string | URL; init?: RequestInit }> = [];
    const fetchFn = async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
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
            requirements: [
              {
                text: "SQL",
                source_quote: "Requires SQL.",
                requirement_type: "hard",
                importance: 0.9,
                keywords: ["sql"],
                verified: false,
              },
            ],
            role_signals: ["analytics"],
            keywords: ["sql"],
            interview_implications: ["Expect SQL questions."],
          }),
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const adapter = new OpenRouterResponsesAdapter({
      config: {
        providerEnabled: true,
        apiKey: "test-key",
        endpoint: "https://openrouter.icu/v1/responses",
        transport: "responses",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        store: false,
      },
      fetchFn,
    });

    const result = await adapter.callStructuredJson({
      task: "jd-analysis",
      skill: skillRegistry.jdAnalysis,
      schema: JDAnalysis,
      instructions: buildJdAnalysisInstructions(),
      input: JSON.stringify({
        job_id: "job-1",
        original_jd_text: "Requires SQL.",
      }),
    });

    expect(result.data.job_id).toBe("job-1");
    expect(result.usage.totalTokens).toBe(30);
    expect(fetchCalls).toHaveLength(1);
    const body = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(body.text.format.type).toBe("json_object");
    expect(body.store).toBe(false);
    expect(body.reasoning.effort).toBe("medium");
  });

  it("classifies missing API keys before making a request", async () => {
    const adapter = new OpenRouterResponsesAdapter({
      config: {
        providerEnabled: true,
        apiKey: null,
        endpoint: "https://openrouter.icu/v1/responses",
        transport: "responses",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        store: false,
      },
      fetchFn: async () => {
        throw new Error("should not fetch");
      },
    });

    await expect(
      adapter.callStructuredJson({
        task: "jd-analysis",
        skill: skillRegistry.jdAnalysis,
        schema: JDAnalysis,
        instructions: "Return JSON.",
        input: "{}",
      }),
    ).rejects.toMatchObject({ kind: "missing_api_key" });
  });

  it("retries once on empty provider output", async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ output_text: "" }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
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
            requirements: [],
            role_signals: [],
            keywords: [],
            interview_implications: [],
          }),
        }),
        { status: 200 },
      );
    };

    const adapter = new OpenRouterResponsesAdapter({
      config: {
        providerEnabled: true,
        apiKey: "test-key",
        endpoint: "https://openrouter.icu/v1/responses",
        transport: "responses",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        store: false,
      },
      fetchFn,
    });

    const result = await adapter.callStructuredJson({
      task: "jd-analysis",
      skill: skillRegistry.jdAnalysis,
      schema: JDAnalysis,
      instructions: "Return JSON.",
      input: "{}",
    });

    expect(result.retryCount).toBe(1);
    expect(calls).toBe(2);
  });

  it("keeps contract failures visible", async () => {
    const adapter = new OpenRouterResponsesAdapter({
      config: {
        providerEnabled: true,
        apiKey: "test-key",
        endpoint: "https://openrouter.icu/v1/responses",
        transport: "responses",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        store: false,
      },
      fetchFn: async () =>
        new Response(JSON.stringify({ output_text: "{\"job_id\":\"missing\"}" }), {
          status: 200,
        }),
    });

    await expect(
      adapter.callStructuredJson({
        task: "jd-analysis",
        skill: skillRegistry.jdAnalysis,
        schema: JDAnalysis,
        instructions: "Return JSON.",
        input: "{}",
      }),
    ).rejects.toBeInstanceOf(JobDeskAiError);
  });

  it("can send OpenRouter chat-completions JSON requests", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  job_id: "job-chat",
                  original_jd_text: "Requires SQL.",
                  job_facts: {
                    company: null,
                    role_title: "Data Analyst",
                    level: null,
                    location: null,
                    responsibilities: [],
                    preferred_qualifications: [],
                  },
                  requirements: [],
                  role_signals: [],
                  keywords: [],
                  interview_implications: [],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 6,
            total_tokens: 11,
          },
        }),
        { status: 200 },
      );
    };

    const adapter = new OpenRouterResponsesAdapter({
      config: {
        providerEnabled: true,
        apiKey: "test-key",
        endpoint: "https://openrouter.icu/v1/chat/completions",
        transport: "chat-completions",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        store: false,
      },
      fetchFn,
    });

    const result = await adapter.callStructuredJson({
      task: "jd-analysis",
      skill: skillRegistry.jdAnalysis,
      schema: JDAnalysis,
      instructions: "Return JSON.",
      input: "{}",
    });

    expect(result.data.job_id).toBe("job-chat");
    expect(result.usage.totalTokens).toBe(11);
    expect(result.skill.skillId).toBe("jd-analysis");
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
    expect(Array.isArray(bodies[0]?.messages)).toBe(true);
  });
});
