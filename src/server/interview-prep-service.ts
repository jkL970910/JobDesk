import { and, desc, eq } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import { interviewPrepPacks, jobs, workflowRuns } from "../db/schema";
import type { JDAnalysis } from "../schemas/jd-analysis";
import { searchPersonalEmbeddings, syncPersonalEmbeddings } from "./embedding-service";
import { getJdAnalysisById } from "./job-repository";
import { getStarStoryBank } from "./profile-evidence-repository";
import type { StarStoryCard } from "./star-story-service";
import { skillRegistry } from "../ai/skills-registry";
import { workflowSkillFields } from "./workflow-run-metadata";
import { getCurrentWorkspace } from "./workspace-repository";

export type InterviewPrepPack = {
  id?: string;
  job_id: string;
  title: string;
  job_snapshot: {
    role_title: string | null;
    company: string | null;
    role_archetype: string;
    legitimacy_tier: string;
  };
  behavioral_questions: BehavioralQuestion[];
  technical_review_topics: TechnicalReviewTopic[];
  company_research_prompts: string[];
  practice_plan: string[];
  evidence_gaps: string[];
  retrieved_context: Array<{
    source_entity_id: string;
    source_entity_type: string;
    similarity: number;
  }>;
  status: "draft" | "ready" | "stale";
  updatedAt?: string;
};

export type BehavioralQuestion = {
  question: string;
  focus: string;
  recommended_story_id: string | null;
  recommended_story_title: string | null;
  star_outline: {
    situation: string | null;
    task: string | null;
    action: string[];
    result: string[];
  };
  gaps: string[];
};

export type TechnicalReviewTopic = {
  topic: string;
  why_it_matters: string;
  source_requirement: string | null;
  practice_prompt: string;
};

export async function generateInterviewPrepPack(jobId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const jobRecord = await getJdAnalysisById(jobId);
  if (!jobRecord) return { status: "not_found" as const };
  const job = toJdAnalysis(jobRecord);

  await syncPersonalEmbeddings();
  const starStoryResult = await getStarStoryBank(12);
  const starStories = starStoryResult.status === "ready" ? starStoryResult.stories : [];
  const retrievalQuery = buildRetrievalQuery(job);
  const retrievedContext = await searchPersonalEmbeddings({
    query: retrievalQuery,
    indexTypes: [
      "evidence_index",
      "initiative_index",
      "portfolio_project_index",
      "project_index",
    ],
    limit: 8,
  });

  const pack = buildInterviewPrepPack({
    job,
    starStories,
    retrievedContext,
  });
  const persisted = await persistInterviewPrepPack(pack);
  return persisted.status === "saved"
    ? { status: "saved" as const, pack: { ...pack, id: persisted.packId } }
    : { status: "saved" as const, pack };
}

export async function getRecentInterviewPrepPacks(limit = 5) {
  if (!hasDatabaseUrl()) return [];
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(interviewPrepPacks)
    .where(eq(interviewPrepPacks.workspaceId, workspace.id))
    .orderBy(desc(interviewPrepPacks.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    job_id: row.jobId,
    title: row.title,
    ...(row.prepJson as Omit<InterviewPrepPack, "id" | "job_id" | "title" | "updatedAt">),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export function buildInterviewPrepPack(args: {
  job: JDAnalysis;
  starStories: StarStoryCard[];
  retrievedContext: Array<{
    source_entity_id: string;
    source_entity_type: string;
    similarity: number;
  }>;
}): InterviewPrepPack {
  const roleTitle = args.job.job_facts.role_title ?? "target role";
  const title = `Interview prep for ${roleTitle}`;
  const behavioralQuestions = buildBehavioralQuestions(args.job, args.starStories);
  const technicalReviewTopics = buildTechnicalReviewTopics(args.job);
  const evidenceGaps = Array.from(
    new Set([
      ...args.job.requirements
        .filter((requirement) => requirement.importance >= 0.75)
        .slice(0, 5)
        .map((requirement) => `Prepare evidence for: ${requirement.text}`),
      ...args.starStories.flatMap((story) =>
        story.gaps.map((gap) => `${story.title}: ${gap}`),
      ),
    ]),
  ).slice(0, 10);

  return {
    job_id: args.job.job_id,
    title,
    job_snapshot: {
      role_title: args.job.job_facts.role_title,
      company: args.job.job_facts.company,
      role_archetype: args.job.role_archetype,
      legitimacy_tier: args.job.job_legitimacy.tier,
    },
    behavioral_questions: behavioralQuestions,
    technical_review_topics: technicalReviewTopics,
    company_research_prompts: buildCompanyResearchPrompts(args.job),
    practice_plan: buildPracticePlan(behavioralQuestions, technicalReviewTopics),
    evidence_gaps: evidenceGaps,
    retrieved_context: args.retrievedContext.map((item) => ({
      source_entity_id: item.source_entity_id,
      source_entity_type: item.source_entity_type,
      similarity: item.similarity,
    })),
    status: "ready",
  };
}

async function persistInterviewPrepPack(pack: InterviewPrepPack) {
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [job] = await db
    .select({ workspaceId: jobs.workspaceId })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspace.id), eq(jobs.id, pack.job_id)))
    .limit(1);
  if (!job) return { status: "not_found" as const };

  const now = new Date();
  const [created] = await db
    .insert(interviewPrepPacks)
    .values({
      workspaceId: job.workspaceId,
      jobId: pack.job_id,
      title: pack.title,
      prepJson: pack as unknown as Record<string, unknown>,
      behavioralQuestions: pack.behavioral_questions as unknown as Array<Record<string, unknown>>,
      technicalReviewTopics: pack.technical_review_topics as unknown as Array<Record<string, unknown>>,
      companyResearchPrompts: pack.company_research_prompts,
      practicePlan: pack.practice_plan,
      evidenceGaps: pack.evidence_gaps,
      status: pack.status,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: interviewPrepPacks.id });

  await db.insert(workflowRuns).values({
    workspaceId: job.workspaceId,
    jobId: pack.job_id,
    workflowType: "interview-prep",
    status: "succeeded",
    provider: "deterministic",
    model: "jobdesk-interview-prep-v1",
    ...workflowSkillFields(skillRegistry.interviewPrepV1),
    retryCount: 0,
    startedAt: now,
    finishedAt: now,
  });

  return created
    ? { status: "saved" as const, packId: created.id }
    : { status: "not_found" as const };
}

type HydratedJdAnalysis = NonNullable<Awaited<ReturnType<typeof getJdAnalysisById>>>;

function toJdAnalysis(job: HydratedJdAnalysis): JDAnalysis {
  return {
    job_id: job.id,
    original_jd_text: job.originalJdText,
    job_facts: job.job_facts,
    role_archetype: (job.role_archetype ?? "unknown") as JDAnalysis["role_archetype"],
    job_legitimacy: job.job_legitimacy,
    requirements: job.requirements,
    role_signals: job.role_signals,
    keywords: job.keywords,
    interview_implications: job.interview_implications,
  };
}

function buildBehavioralQuestions(job: JDAnalysis, stories: StarStoryCard[]) {
  const focusAreas = Array.from(
    new Set([
      ...job.role_signals,
      ...job.keywords,
      ...job.interview_implications,
      ...job.requirements
        .sort((left, right) => right.importance - left.importance)
        .flatMap((requirement) => requirement.keywords),
    ]),
  )
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
  const fallbackAreas = ["stakeholder alignment", "analytical execution", "delivery ownership"];
  return (focusAreas.length > 0 ? focusAreas : fallbackAreas)
    .map((focus) => {
      const story = selectStoryForFocus(focus, stories);
      return {
        question: `Tell me about a time you used ${focus} to solve a role-relevant problem.`,
        focus,
        recommended_story_id: story?.id ?? null,
        recommended_story_title: story?.title ?? null,
        star_outline: {
          situation: story?.situation ?? null,
          task: story?.task ?? null,
          action: story?.action.slice(0, 3) ?? [],
          result: story?.result.slice(0, 3) ?? [],
        },
        gaps: story?.gaps ?? ["Add a sourced STAR story for this focus area."],
      };
    })
    .slice(0, 6);
}

function buildTechnicalReviewTopics(job: JDAnalysis) {
  const hardRequirements = job.requirements
    .filter((requirement) => requirement.requirement_type === "hard")
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 8);
  return hardRequirements.map((requirement) => {
    const topic = requirement.keywords[0] ?? requirement.text.split(" ").slice(0, 4).join(" ");
    return {
      topic,
      why_it_matters: `High-importance requirement for ${job.job_facts.role_title ?? "this role"}.`,
      source_requirement: requirement.text,
      practice_prompt: `Prepare a concise example that proves: ${requirement.text}`,
    };
  });
}

function buildCompanyResearchPrompts(job: JDAnalysis) {
  const company = job.job_facts.company ?? "the company";
  return [
    `Find recent product, business, or hiring signals for ${company}.`,
    `Search public interview reports for ${company} and this role family.`,
    `Identify likely domain knowledge expected for ${job.job_facts.role_title ?? "the target role"}.`,
  ];
}

function buildPracticePlan(
  questions: BehavioralQuestion[],
  topics: TechnicalReviewTopic[],
) {
  return [
    `Draft answers for ${Math.min(questions.length, 4)} behavioral questions using STAR.`,
    `Review ${Math.min(topics.length, 5)} technical topics and attach one evidence-backed example to each.`,
    "Run one 30-minute mock screen: opening pitch, two behavior questions, one technical deep dive.",
    "Before the interview, re-check unsupported claims and missing evidence gaps.",
  ];
}

function buildRetrievalQuery(job: JDAnalysis) {
  return [
    job.job_facts.role_title,
    ...job.keywords,
    ...job.role_signals,
    ...job.interview_implications,
    ...job.requirements.flatMap((requirement) => [
      requirement.text,
      ...requirement.keywords,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

function selectStoryForFocus(focus: string, stories: StarStoryCard[]) {
  const normalized = focus.toLowerCase();
  return (
    stories.find((story) =>
      [
        story.title,
        story.situation,
        story.task,
        ...story.action,
        ...story.result,
        ...story.technologies,
        ...story.stakeholders,
        ...story.interview_angles,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    ) ?? stories[0]
  );
}
