/**
 * Generates JSON Schema files from the Zod source of truth.
 * Zod is authoritative; the .json files under schemas-json/ are generated
 * artifacts — do not hand-edit them. Run: npm run gen:jsonschema
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

import { Profile } from "../src/schemas/profile";
import { EvidenceItem, ProjectCard, StarStory } from "../src/schemas/evidence";
import { JDAnalysis } from "../src/schemas/jd-analysis";
import { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";
import { TailoredResume, GeneratedClaim } from "../src/schemas/tailored-resume";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "schemas-json");
mkdirSync(outDir, { recursive: true });

const targets = {
  "profile.schema.json": Profile,
  "evidence.schema.json": EvidenceItem,
  "project.schema.json": ProjectCard,
  "star-story.schema.json": StarStory,
  "jd-analysis.schema.json": JDAnalysis,
  "profile-evidence-extraction.schema.json": ProfileEvidenceExtraction,
  "tailored-resume.schema.json": TailoredResume,
  "generated-claim.schema.json": GeneratedClaim,
} as const;

for (const [file, schema] of Object.entries(targets)) {
  const json = zodToJsonSchema(schema, { name: file.replace(".schema.json", "") });
  writeFileSync(join(outDir, file), JSON.stringify(json, null, 2) + "\n");
  console.log(`generated schemas-json/${file}`);
}
console.log("Done. JSON Schema is generated from Zod — do not hand-edit.");
