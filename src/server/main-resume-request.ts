import { z } from "zod";

import {
  MainResumeGenerationMode,
  ResumeRefreshMode,
  ResumeRefreshStyleConstraints,
} from "../schemas/main-resume";

export const MainResumePostRequest = z
  .object({
    mode: MainResumeGenerationMode.optional(),
    generationMode: MainResumeGenerationMode.optional(),
    positioningReportId: z.string().uuid().optional(),
    positioningDirectionId: z.string().trim().min(1).optional(),
    sourceResumeVersionId: z.string().uuid().optional(),
    refreshSourceResumeId: z.string().uuid().optional(),
    refreshMode: ResumeRefreshMode.optional(),
    styleConstraints: ResumeRefreshStyleConstraints.optional(),
  })
  .optional();

export type MainResumePostRequest = z.infer<typeof MainResumePostRequest>;

export function inferMainResumeGenerationMode(selection: MainResumePostRequest) {
  if (selection?.mode) return selection.mode;
  if (selection?.generationMode) return selection.generationMode;
  if (selection?.sourceResumeVersionId || selection?.refreshSourceResumeId) {
    return "resume_refresh" as const;
  }
  if (selection?.positioningReportId || selection?.positioningDirectionId) {
    return "positioning_variant" as const;
  }
  return "main_resume" as const;
}

export function validateMainResumeModeSelection(
  selection: MainResumePostRequest,
  generationMode = inferMainResumeGenerationMode(selection),
) {
  if (generationMode === "positioning_variant") {
    if (!selection?.positioningReportId || !selection.positioningDirectionId) {
      throw new MainResumeRequestError(
        "Select both a positioning report and a direction before generating a variant.",
      );
    }
  }

  if (generationMode === "resume_refresh") {
    if (!getMainResumeRefreshSourceId(selection)) {
      throw new MainResumeRequestError("Select an old resume before refreshing it.");
    }
    if (!selection?.refreshMode) {
      throw new MainResumeRequestError("Select a refresh mode before refreshing a resume.");
    }
  }

  return generationMode;
}

export function getMainResumeRefreshSourceId(selection: MainResumePostRequest) {
  return selection?.sourceResumeVersionId ?? selection?.refreshSourceResumeId ?? null;
}

export class MainResumeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MainResumeRequestError";
  }
}
