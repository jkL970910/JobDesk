export type MainResumeExportFormat = "markdown" | "json" | "docx" | "html";

export function getMainResumeExportBlocker(args: {
  format: MainResumeExportFormat;
  status: string;
}) {
  const finalExportFormats: MainResumeExportFormat[] = ["markdown", "docx", "html"];
  if (finalExportFormats.includes(args.format) && args.status !== "validated") {
    return {
      error:
        "Final resume export is blocked until Fact Guard validates every generated claim. Use JSON audit export for review.",
      kind: "resume_not_validated" as const,
    };
  }
  return null;
}
