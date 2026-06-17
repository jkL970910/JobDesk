import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SkillRegistryEntry, SourceSkillId } from "./skills-registry";

type LoadedSourceSkill = {
  id: SourceSkillId;
  name: string;
  version: string;
  hardRules: string;
};

const skillCache = new Map<SourceSkillId, LoadedSourceSkill>();
const projectRoot = process.cwd();

export function composeSkillPrompt(
  entry: SkillRegistryEntry,
  baseInstructions: readonly string[],
) {
  const sourceSkillBlocks = entry.sourceSkillIds.map((sourceSkillId) => {
    const sourceSkill = loadSourceSkill(sourceSkillId);
    if (sourceSkill.version !== entry.skillVersion) {
      throw new Error(
        `Skill version mismatch for ${entry.skillId}: registry=${entry.skillVersion}, ${sourceSkillId}=${sourceSkill.version}`,
      );
    }
    return [
      `Source skill: ${sourceSkill.name}@${sourceSkill.version}`,
      "Hard rules loaded from SKILL.md:",
      sourceSkill.hardRules,
    ].join("\n");
  });

  return [
    ...baseInstructions,
    "",
    "Runtime Skills Registry binding:",
    `skill_id=${entry.skillId}`,
    `skill_version=${entry.skillVersion}`,
    `prompt_version=${entry.promptVersion}`,
    `schema=${entry.schemaName}@${entry.schemaVersion}`,
    "Apply the following source-skill hard rules. Workflow-specific instructions above may narrow scope, but must not weaken these rules.",
    ...sourceSkillBlocks,
  ].join("\n");
}

export function loadSourceSkill(sourceSkillId: SourceSkillId): LoadedSourceSkill {
  const cached = skillCache.get(sourceSkillId);
  if (cached) return cached;

  const skillPath = join(projectRoot, "skills", sourceSkillId, "SKILL.md");
  const markdown = readFileSync(skillPath, "utf8");
  const metadata = parseFrontmatter(markdown);
  const hardRules = extractHardRules(markdown);
  const loaded = {
    id: sourceSkillId,
    name: metadata.name ?? sourceSkillId,
    version: metadata.version ?? "",
    hardRules,
  };
  skillCache.set(sourceSkillId, loaded);
  return loaded;
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1];
  if (!frontmatter) return {} as Record<string, string>;
  const metadata: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const [rawKey, ...rawValueParts] = line.split(":");
    if (!rawKey || rawValueParts.length === 0) continue;
    const value = rawValueParts.join(":").trim();
    if (!value || value === ">") continue;
    metadata[rawKey.trim()] = value.replace(/^["']|["']$/g, "");
  }
  return metadata;
}

function extractHardRules(markdown: string) {
  const hardRulesMatch =
    markdown.match(/## Hard rules[^\n]*\n([\s\S]*?)(?=\n## )/) ??
    markdown.match(/## Hard rules \(non-negotiable\)\n([\s\S]*?)(?=\n## )/) ??
    markdown.match(/## Role boundary \(important\)\n([\s\S]*?)(?=\n## )/);
  if (!hardRulesMatch) {
    throw new Error("Skill file is missing a hard-rules section.");
  }
  const hardRules = hardRulesMatch[1];
  if (!hardRules) {
    throw new Error("Skill file has an empty hard-rules section.");
  }
  return hardRules.trim();
}
