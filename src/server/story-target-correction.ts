import {
  assignInitiativeToWorkExperience,
  convertInitiativeToPortfolioProject,
  convertPortfolioProjectToInitiative,
  createWorkExperienceAndAssignInitiative,
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

export type StoryTargetCorrection =
  | {
      action: "mark_reviewed" | "mark_needs_update" | "reject_story";
      targetId: string;
      targetType: StoryTargetType;
    }
  | {
      action: "assign_work_experience";
      targetId: string;
      targetType: "initiative";
      workExperienceId: string | null;
    }
  | {
      action: "convert_to_initiative";
      targetId: string;
      targetType: "portfolio_project";
      workExperienceId: string;
    }
  | {
      action: "convert_to_portfolio_project";
      targetId: string;
      targetType: "initiative";
      projectType?: PortfolioProjectType;
    }
  | {
      action: "create_work_experience_and_assign";
      targetId: string;
      targetType: "initiative";
      employer: string;
      roleTitle: string;
      team?: string | null;
      location?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      summary?: string | null;
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
        workExperienceId: correction.workExperienceId,
      });
    case "convert_to_initiative":
      return convertPortfolioProjectToInitiative({
        portfolioProjectId: correction.targetId,
        workExperienceId: correction.workExperienceId,
      });
    case "convert_to_portfolio_project":
      return convertInitiativeToPortfolioProject({
        initiativeId: correction.targetId,
        projectType: correction.projectType,
      });
    case "create_work_experience_and_assign":
      return createWorkExperienceAndAssignInitiative({
        initiativeId: correction.targetId,
        employer: correction.employer,
        roleTitle: correction.roleTitle,
        team: correction.team,
        location: correction.location,
        startDate: correction.startDate,
        endDate: correction.endDate,
        summary: correction.summary,
      });
  }
}
