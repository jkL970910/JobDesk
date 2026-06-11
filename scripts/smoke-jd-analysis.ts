import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadDotEnv } from "../src/ai/env";
import { JobDeskAiError } from "../src/ai/errors";
import { analyzeJobDescriptionWithAi } from "../src/ai/jd-analysis";

loadDotEnv();

const sampleJd = [
  "Senior Product Analyst",
  "We are looking for 5+ years of experience in product analytics, SQL, and dashboard development.",
  "Experience with experimentation, stakeholder communication, and financial services is preferred.",
  "The role partners with product managers and engineering teams to define metrics and improve customer journeys.",
].join("\n");

function readArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const fileArg = readArgValue("--file");
const textArg = readArgValue("--text");
const jdText = fileArg
  ? readFileSync(resolve(fileArg), "utf8")
  : textArg
    ? textArg
    : sampleJd;

try {
  const result = await analyzeJobDescriptionWithAi({
    jobId: "smoke-jd",
    jdText,
  });

  console.log(JSON.stringify(result.data, null, 2));
  console.error(
    JSON.stringify(
      {
        usage: result.usage,
        retryCount: result.retryCount,
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (error instanceof JobDeskAiError) {
    console.error(
      JSON.stringify(
        {
          error: error.message,
          kind: error.kind,
          status: error.status,
          retryCount: error.retryCount,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
