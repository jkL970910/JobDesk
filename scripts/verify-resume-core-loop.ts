import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type ResumeCoreLoopVerificationOptions = {
  includeIntegration?: boolean;
};

export type ResumeCoreLoopVerificationStep = {
  args: string[];
  command: string;
  description: string;
  integration?: boolean;
  label: string;
};

export const resumeCoreLoopTargetedTests = [
  "tests/cleanup-dirty-source.test.ts",
  "tests/resume-evidence-eligibility.test.ts",
  "tests/evidence-route.test.ts",
  "tests/evidence-quarantine-route.test.ts",
  "tests/resume-readiness-worklist.test.ts",
  "tests/resume-export.test.ts",
  "tests/tailored-resume-export-route.test.ts",
  "tests/retrieval-service.test.ts",
  "tests/resume-review-run-routes.test.ts",
] as const;

export function buildResumeCoreLoopVerificationPlan(
  options: ResumeCoreLoopVerificationOptions = {},
): ResumeCoreLoopVerificationStep[] {
  const steps: ResumeCoreLoopVerificationStep[] = [
    {
      args: ["test", "--", ...resumeCoreLoopTargetedTests],
      command: "npm",
      description:
        "Runs the source cleanup, evidence eligibility/action, readiness, export, retrieval, and resume review run checks.",
      label: "Resume Core Loop targeted tests",
    },
    {
      args: ["run", "typecheck"],
      command: "npm",
      description: "Checks the Next.js and TypeScript contract after the core-loop changes.",
      label: "Typecheck",
    },
    {
      args: ["run", "build"],
      command: "npm",
      description: "Verifies the production build can compile the resume workflow surfaces.",
      label: "Production build",
    },
  ];

  if (options.includeIntegration) {
    steps.push({
      args: ["run", "test:integration"],
      command: "npm",
      description:
        "Runs the configured database-backed integration suite. This writes temporary rows to the configured JobDesk database.",
      integration: true,
      label: "Database integration tests",
    });
  }

  return steps;
}

export function parseResumeCoreLoopVerificationArgs(argv = process.argv.slice(2)) {
  return {
    includeIntegration: argv.includes("--integration"),
    listOnly: argv.includes("--list"),
  };
}

function runPlan(steps: ResumeCoreLoopVerificationStep[]) {
  for (const step of steps) {
    console.log(`\n== ${step.label} ==`);
    console.log(step.description);
    console.log(`$ ${step.command} ${step.args.join(" ")}`);

    const result = spawnSync(step.command, step.args, {
      env: process.env,
      shell: false,
      stdio: "inherit",
    });

    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

export function main() {
  const options = parseResumeCoreLoopVerificationArgs();
  const steps = buildResumeCoreLoopVerificationPlan(options);

  if (options.listOnly) {
    console.log(
      JSON.stringify(
        steps.map((step) => ({
          args: step.args,
          command: step.command,
          integration: Boolean(step.integration),
          label: step.label,
        })),
        null,
        2,
      ),
    );
    return;
  }

  runPlan(steps);
  console.log("\nResume Core Loop verification passed.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
