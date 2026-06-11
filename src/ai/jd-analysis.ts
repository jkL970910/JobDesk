import { JDAnalysis } from "../schemas/jd-analysis";
import { resolveJobDeskAiConfig } from "./config";
import { OpenRouterResponsesAdapter } from "./openrouter-adapter";
import type { FetchLike } from "./types";

export async function analyzeJobDescriptionWithAi(params: {
  jobId: string;
  jdText: string;
  fetchFn?: FetchLike;
}) {
  const adapter = new OpenRouterResponsesAdapter({
    config: resolveJobDeskAiConfig(),
    fetchFn: params.fetchFn,
  });
  return adapter.callStructuredJson({
    task: "jd-analysis",
    schema: JDAnalysis,
    instructions: buildJdAnalysisInstructions(),
    input: buildJdAnalysisInput(params.jobId, params.jdText),
    maxOutputTokens: 2400,
    timeoutMs: 120_000,
  });
}

export function buildJdAnalysisInstructions() {
  return [
    "You are JobDesk's JD Analyst.",
    "Convert one job description into a structured requirement matrix.",
    "Return only a valid JSON object. Do not return markdown.",
    "Use exactly these top-level keys: job_id, original_jd_text, job_facts, role_archetype, job_legitimacy, requirements, role_signals, keywords, interview_implications.",
    "role_archetype must be one of: ai_platform_llmops, agentic_automation, technical_ai_pm, ai_solutions_architect, ai_forward_deployed, ai_transformation, hybrid, unknown.",
    "job_legitimacy must be an object with exactly these keys: tier, signals, context_notes.",
    "job_legitimacy.tier must be high_confidence, proceed_with_caution, or suspicious. Never mark suspicious without concrete evidence.",
    "job_legitimacy.signals must be observations from the JD text only unless external page/search evidence is provided in the input.",
    "job_facts must be an object with exactly these keys: company, role_title, level, location, responsibilities, preferred_qualifications.",
    "Use null for unknown company, role_title, level, or location. Use [] for unknown responsibilities or preferred_qualifications.",
    "Only extract job_facts that are stated or strongly implied by the JD. Do not invent company names, locations, or levels.",
    "Do not include extra keys such as id, category, requirement, type, signal, or implication.",
    "requirements must be an array of objects with exactly these keys: text, source_quote, requirement_type, importance, keywords, verified.",
    "requirement_type must be exactly hard or soft.",
    "importance must be a number from 0 to 1.",
    "keywords must be an array of strings.",
    "role_signals, keywords, and interview_implications must each be arrays of strings, not arrays of objects.",
    "Every requirement must include a verbatim source_quote from the JD.",
    "Do not add industry-standard requirements that the JD does not state.",
    "Classify explicit must-haves as hard and preferred/nice-to-have items as soft.",
    "When unsure, classify the requirement as soft.",
    "Set verified=false for every requirement; deterministic code verifies quotes later.",
    "Example requirement: {\"text\":\"SQL\",\"source_quote\":\"Requires SQL.\",\"requirement_type\":\"hard\",\"importance\":0.9,\"keywords\":[\"sql\"],\"verified\":false}.",
  ].join("\n");
}

function buildJdAnalysisInput(jobId: string, jdText: string) {
  return JSON.stringify({
    job_id: jobId,
    original_jd_text: jdText,
  });
}
