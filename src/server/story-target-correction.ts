import {
  assignInitiativeToWorkExperience,
  convertInitiativeToPortfolioProject,
  convertPortfolioProjectToInitiative,
  createWorkExperienceAndAssignInitiative,
  splitInitiativeStoryTarget,
  updateStoryTargetReview,
} from "./profile-evidence-repository";

type StoryTargetType = "initiative" | "portfolio_project";
type PortfolioProjectType =
  | "personal_project"
  | "academic_project"
  | "open_source"
  | "freelance"
  | "hackathon"
  | "general_project";

type StoryTargetCorrectionAction =
  | "mark_reviewed"
  | "mark_needs_update"
  | "reject_story"
  | "assign_work_experience"
  | "convert_to_initiative"
  | "convert_to_portfolio_project"
  | "create_work_experience_and_assign"
  | "split_story";

export type StoryTargetCorrection = {
  action: StoryTargetCorrectionAction;
  targetId: string;
  targetType: StoryTargetType;
  payload?: {
    workExperienceId?: string | null;
    projectType?: PortfolioProjectType;
    employer?: string;
    roleTitle?: string;
    team?: string | null;
    location?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    summary?: string | null;
    actions?: string[];
    context?: string | null;
    destinationTargetId?: string | null;
    evidenceItemIds?: string[];
    problem?: string | null;
    results?: string[];
    sourceDocumentId?: string | null;
    splitTargetType?: "initiative" | "portfolio_project";
    technologies?: string[];
    title?: string;
  };
};

export async function applyStoryTargetCorrection(correction: StoryTargetCorrection) {
  switch (correction.action) {
    case "mark_reviewed":
    case "mark_needs_update":
    case "reject_story":
      return updateStoryTargetReview({
        action: correction.action,
        targetId: correction.targetId,
        targetType: correction.targetType,
      });
    case "assign_work_experience":
      return assignInitiativeToWorkExperience({
        initiativeId: correction.targetId,
        workExperienceId: correction.payload?.workExperienceId ?? null,
      });
    case "convert_to_initiative":
      if (!correction.payload?.workExperienceId) {
        return { status: "invalid" as const, reason: "Work Experience is required for this correction." };
      }
      return convertPortfolioProjectToInitiative({
        portfolioProjectId: correction.targetId,
        workExperienceId: correction.payload.workExperienceId,
      });
    case "convert_to_portfolio_project":
      return convertInitiativeToPortfolioProject({
        initiativeId: correction.targetId,
        projectType: correction.payload?.projectType,
      });
    case "create_work_experience_and_assign":
      if (!correction.payload?.employer || !correction.payload.roleTitle) {
        return { status: "invalid" as const, reason: "Employer and role title are required for this correction." };
      }
      return createWorkExperienceAndAssignInitiative({
        initiativeId: correction.targetId,
        employer: correction.payload.employer,
        roleTitle: correction.payload.roleTitle,
        team: correction.payload.team,
        location: correction.payload.location,
        startDate: correction.payload.startDate,
        endDate: correction.payload.endDate,
        summary: correction.payload.summary,
      });
    case "split_story":
      if (correction.targetType !== "initiative") {
        return { status: "invalid" as const, reason: "Only Work Initiatives can be split." };
      }
      if (!correction.payload?.title || !correction.payload.evidenceItemIds?.length) {
        return { status: "invalid" as const, reason: "Title and Evidence Claims are required for split." };
      }
      return splitInitiativeStoryTarget({
        actions: correction.payload.actions,
        context: correction.payload.context,
        destinationTargetId: correction.payload.destinationTargetId,
        evidenceItemIds: correction.payload.evidenceItemIds,
        problem: correction.payload.problem,
        projectType: correction.payload.projectType,
        results: correction.payload.results,
        sourceDocumentId: correction.payload.sourceDocumentId,
        sourceInitiativeId: correction.targetId,
        targetType: correction.payload.splitTargetType,
        technologies: correction.payload.technologies,
        title: correction.payload.title,
        workExperienceId: correction.payload.workExperienceId,
      });
  }
}
