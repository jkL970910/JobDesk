import { existsSync, readFileSync } from "node:fs";

loadLocalEnv();
const { runProfileEvidenceExtractionWorkerOnce } = await import(
  "../src/server/profile-evidence-extraction-worker"
);
const result = await runProfileEvidenceExtractionWorkerOnce();
console.log(JSON.stringify(result, null, 2));

function loadLocalEnv() {
  if (!existsSync(".env")) return;
  const contents = readFileSync(".env", "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
}
