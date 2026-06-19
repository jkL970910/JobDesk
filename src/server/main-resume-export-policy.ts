export type MainResumeExportFormat = "markdown" | "json" | "docx" | "html";
export type ResumeExportFormat = MainResumeExportFormat;

export function getResumeFinalExportBlocker(args: {
  format: ResumeExportFormat;
  status: string;
}) {
  const finalExportFormats: ResumeExportFormat[] = ["markdown", "docx", "html"];
  if (finalExportFormats.includes(args.format) && args.status !== "validated") {
    return {
      error:
        "Final resume export is blocked until Fact Guard validates every generated claim. Use JSON audit export for review.",
      kind: "resume_not_validated" as const,
    };
  }
  return null;
}

export function getMainResumeExportBlocker(args: {
  format: MainResumeExportFormat;
  status: string;
}) {
  return getResumeFinalExportBlocker(args);
}
