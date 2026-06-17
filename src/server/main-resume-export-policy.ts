export type MainResumeExportFormat = "markdown" | "json";

export function getMainResumeExportBlocker(args: {
  format: MainResumeExportFormat;
  status: string;
}) {
  if (args.format === "markdown" && args.status !== "validated") {
    return {
      error:
        "Main resume export is blocked until Fact Guard validates every generated claim. Use JSON export for audit review.",
      kind: "resume_not_validated" as const,
    };
  }
  return null;
}
