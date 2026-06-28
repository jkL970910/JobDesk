export type ResumeReviewReport = {
  overallScore: number;
  rubric: Array<{
    evidenceQuestions: string[];
    findings: string[];
    key: string;
    label: string;
    score: number;
    maxScore: number;
    note: string;
    nextAction?: string;
  }>;
  strengths: string[];
  weaknesses: string[];
  recommendedActions: string[];
  missingEvidenceQuestions: string[];
  riskFlags: string[];
};

export function buildResumeReviewReport(sourceText: string): ResumeReviewReport {
  const text = sourceText.trim();
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^[-*•]|\d+\./.test(line));
  const lower = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const metrics = text.match(/\b\d+(?:[.,]\d+)?\s*(?:%|percent|k|m|million|users|customers|teams|hours|days|weeks|months|years)?\b/gi) ?? [];
  const actionVerbMatches = text.match(/\b(led|built|created|launched|owned|managed|improved|reduced|increased|designed|implemented|automated|analyzed|partnered|shipped|migrated|optimized)\b/gi) ?? [];
  const hasContact = /@|linkedin\.com|github\.com|portfolio|http/i.test(text);
  const hasExperience = /(experience|work history|employment|present|20\d{2}|19\d{2})/i.test(text);
  const hasEducation = /(education|university|college|bachelor|master|degree|bsc|msc|mba)/i.test(text);
  const hasSkills = /(skills|technologies|tools|sql|python|javascript|react|analytics|excel)/i.test(text);
  const hasProjects = /(project|initiative|dashboard|migration|launch|experiment|platform|automation)/i.test(text);
  const hasWeakPhrases = /\b(responsible for|helped with|worked on|various|etc\.?|some)\b/i.test(text);
  const hasSensitiveSignals = /\b(confidential|internal only|nda|salary|ssn|sin|passport)\b/i.test(text);
  const calibratedCeiling = calculateFallbackScoreCeiling({
    actionVerbCount: actionVerbMatches.length,
    bulletCount: bullets.length,
    hasContact,
    hasEducation,
    hasExperience,
    hasProjects,
    hasSkills,
    hasWeakPhrases,
    metricCount: metrics.length,
    wordCount,
  });

  const rubric = [
    scoreSection({
      evidenceQuestions: [
        "Which section is the source of truth for your latest role, education, skills, and contact details?",
      ],
      findings: [
        hasContact ? "Contact or portfolio signal is visible." : "Contact or portfolio signal may be incomplete.",
        hasExperience ? "Work experience is visible." : "Work experience section is missing or hard to parse.",
      ],
      key: "structure",
      label: "Structure",
      score: Math.min(20, scoreBool(hasContact, 4) + scoreBool(hasExperience, 6) + scoreBool(hasEducation, 4) + scoreBool(hasSkills, 4) + scoreBool(wordCount >= 250, 2)),
      maxScore: 20,
      good: "Core resume sections are present.",
      weak: "Resume structure is missing one or more expected sections.",
      nextAction: "Fill missing resume sections before extracting or rewriting evidence.",
    }),
    scoreSection({
      evidenceQuestions: [
        "Which achievements have numbers such as revenue, time saved, adoption, scale, or quality improvement?",
      ],
      findings: [
        metrics.length >= 3
          ? "Several measurable outcomes are visible."
          : "Impact claims need more quantified proof.",
        actionVerbMatches.length >= 6
          ? "Action-led claims are present."
          : "Some bullets may read as responsibility rather than outcome.",
      ],
      key: "impact",
      label: "Impact evidence",
      score: Math.min(25, metrics.length * 3 + Math.min(10, actionVerbMatches.length) + scoreBool(bullets.length >= 4, 4)),
      maxScore: 25,
      good: "Resume includes measurable outcomes and action-oriented claims.",
      weak: "Add more quantified outcomes and action-led bullets.",
      nextAction: "Attach measurable outcomes or source-backed proof before using these claims in a resume draft.",
    }),
    scoreSection({
      evidenceQuestions: [
        hasProjects
          ? "Which project had the clearest ownership, scope, technical decision, and result?"
          : "Which 2-4 projects best prove your target role fit?",
      ],
      findings: [
        hasProjects
          ? "Project or initiative signals are visible."
          : "Project or initiative signals are thin or missing.",
        metrics.length >= 3
          ? "Some project outcomes include measurable evidence."
          : "Project stories need clearer context, actions, and results.",
      ],
      key: "project_depth",
      label: "Project depth",
      score: Math.min(20, scoreBool(hasProjects, 8) + Math.min(8, countMatches(lower, ["launched", "built", "designed", "implemented", "migrated", "automated"]) * 2) + scoreBool(metrics.length >= 3, 4)),
      maxScore: 20,
      good: "Project or initiative signals are visible.",
      weak: "Project stories need clearer context, actions, and results.",
      nextAction: "Add source-backed project context: ownership, scope, technical decisions, and measurable results.",
    }),
    scoreSection({
      evidenceQuestions: [
        "Which vague bullets should be rewritten into clearer action-result statements?",
      ],
      findings: [
        bullets.length >= 4 ? "Bullet structure is visible." : "Resume needs clearer bullet structure.",
        hasWeakPhrases ? "Some wording is vague or responsibility-oriented." : "Wording is reasonably direct.",
      ],
      key: "readability",
      label: "Readability",
      score: Math.min(15, scoreBool(wordCount >= 250 && wordCount <= 1200, 5) + scoreBool(bullets.length >= 4, 5) + scoreBool(!hasWeakPhrases, 5)),
      maxScore: 15,
      good: "Resume is reasonably scan-friendly.",
      weak: "Tighten vague wording and use stronger bullet structure.",
      nextAction: "Make the first scan obvious: target role, strongest scope, and highest-impact bullets.",
    }),
    scoreSection({
      evidenceQuestions: [
        "Which bullets are safe to share publicly, and which need external-safe rewriting?",
        "Which claims have reusable source evidence that can become library items?",
      ],
      findings: [
        hasSensitiveSignals
          ? "Some wording may need external-safe rewriting before resume use."
          : "No obvious sensitive wording was detected by the quick review.",
        hasProjects || metrics.length >= 2
          ? "Resume contains reusable source signals for the evidence library."
          : "Evidence extraction may create thin cards unless more project detail is added.",
      ],
      key: "evidence_readiness",
      label: "Evidence readiness",
      score: Math.min(20, scoreBool(hasSkills, 4) + scoreBool(hasProjects, 4) + Math.min(6, metrics.length * 2) + Math.min(6, actionVerbMatches.length)),
      maxScore: 20,
      good: "Resume contains reusable source signals for the evidence library.",
      weak: "Evidence extraction will likely create thin cards unless more project detail is added.",
      nextAction: "Create library items, then review generated claims and external-safe wording before resume use.",
    }),
  ];

  const rawScore = rubric.reduce((sum, item) => sum + item.score, 0);
  const overallScore = Math.max(0, Math.min(calibratedCeiling, rawScore));
  const riskFlags = [
    ...(hasSensitiveSignals ? ["Sensitive or internal-only language may need external-safe rewriting."] : []),
    ...(wordCount < 180 ? ["Resume text is short; extraction may miss important project context."] : []),
    ...(metrics.length === 0 ? ["No obvious quantified outcomes detected."] : []),
  ];
  const weaknesses = [
    ...rubric.filter((item) => item.score / item.maxScore < 0.6).map((item) => item.note),
    ...(hasWeakPhrases ? ["Replace vague phrases like responsible for or worked on with direct ownership and outcomes."] : []),
  ];
  const strengths = rubric
    .filter((item) => item.score / item.maxScore >= 0.75)
    .map((item) => item.note);

  return {
    overallScore,
    rubric,
    strengths: strengths.length > 0 ? strengths : ["Resume has enough readable text to begin review."],
    weaknesses: uniqueStrings(weaknesses).slice(0, 6),
    recommendedActions: buildRecommendedActions({ hasProjects, metricsCount: metrics.length, hasWeakPhrases, wordCount }),
    missingEvidenceQuestions: buildMissingEvidenceQuestions({ hasProjects, metricsCount: metrics.length }),
    riskFlags,
  };
}

function calculateFallbackScoreCeiling(args: {
  actionVerbCount: number;
  bulletCount: number;
  hasContact: boolean;
  hasEducation: boolean;
  hasExperience: boolean;
  hasProjects: boolean;
  hasSkills: boolean;
  hasWeakPhrases: boolean;
  metricCount: number;
  wordCount: number;
}) {
  let ceiling = 86;
  if (args.metricCount < 5) ceiling -= 6;
  if (args.actionVerbCount < 8) ceiling -= 5;
  if (args.bulletCount < 6) ceiling -= 5;
  if (args.wordCount < 250 || args.wordCount > 1200) ceiling -= 4;
  if (!args.hasProjects) ceiling -= 6;
  if (!args.hasExperience || !args.hasSkills) ceiling -= 6;
  if (!args.hasContact || !args.hasEducation) ceiling -= 3;
  if (args.hasWeakPhrases) ceiling -= 4;
  return Math.max(45, ceiling);
}

function scoreBool(value: boolean, score: number) {
  return value ? score : 0;
}

function countMatches(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term)).length;
}

function scoreSection(args: {
  evidenceQuestions: string[];
  findings: string[];
  key: string;
  label: string;
  score: number;
  maxScore: number;
  good: string;
  nextAction: string;
  weak: string;
}) {
  return {
    evidenceQuestions: uniqueStrings(args.evidenceQuestions),
    findings: uniqueStrings(args.findings),
    key: args.key,
    label: args.label,
    score: Math.max(0, Math.min(args.maxScore, args.score)),
    maxScore: args.maxScore,
    note: args.score / args.maxScore >= 0.65 ? args.good : args.weak,
    nextAction: args.nextAction,
  };
}

function buildRecommendedActions(args: {
  hasProjects: boolean;
  metricsCount: number;
  hasWeakPhrases: boolean;
  wordCount: number;
}) {
  return uniqueStrings([
    ...(args.metricsCount < 3 ? ["Add measurable outcomes for the strongest 3-5 achievements."] : []),
    ...(!args.hasProjects ? ["Add project names or initiative context before extracting evidence."] : []),
    ...(args.hasWeakPhrases ? ["Rewrite passive responsibility bullets into action-result bullets."] : []),
    ...(args.wordCount < 250 ? ["Upload a fuller resume or add project notes for better evidence extraction."] : []),
    "After review, extract resume signals into the Evidence Library and enrich thin initiatives or portfolio projects.",
  ]);
}

function buildMissingEvidenceQuestions(args: {
  hasProjects: boolean;
  metricsCount: number;
}) {
  return uniqueStrings([
    ...(args.metricsCount < 3 ? ["Which achievements have numbers such as revenue, time saved, adoption, scale, or quality improvement?"] : []),
    ...(!args.hasProjects ? ["Which 2-4 projects best prove your target role fit?"] : []),
    "Which bullets are safe to share publicly, and which need external-safe rewriting?",
  ]);
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}
