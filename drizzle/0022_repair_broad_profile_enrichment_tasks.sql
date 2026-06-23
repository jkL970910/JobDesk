WITH broad_profile_tasks AS (
  SELECT "id"
  FROM "enrichment_tasks"
  WHERE
    "source_type" = 'resume_review'
    AND "status" IN ('open', 'answered')
    AND (
      "prompt" ~* '(future roles?|future software engineering roles?|career direction|general profile|profile positioning|technical skills section)'
      OR (
        "prompt" ~* '(future|target|preferred|preference|emphasize|emphasized|highlight|positioning|direction|strongest|most recent|recent|prioritize|focus)'
        AND "prompt" ~* '(skills?|technical skills?|skills section|listed skills?|profile|career|software engineering roles?|engineering roles?|role direction|target roles?)'
        AND "prompt" ~* '(which|what|where|how|would you|do you want|should)'
      )
    )
)
UPDATE "enrichment_proposals"
SET
  "status" = 'rejected',
  "reviewed_at" = now(),
  "updated_at" = now()
WHERE
  "status" = 'pending_review'
  AND "proposal_type" <> 'clarify_assignment'
  AND "task_id" IN (SELECT "id" FROM broad_profile_tasks);
--> statement-breakpoint
WITH repaired_tasks AS (
  UPDATE "enrichment_tasks"
  SET
    "evidence_item_id" = NULL,
    "work_experience_id" = NULL,
    "initiative_id" = NULL,
    "portfolio_project_id" = NULL,
    "target_scope" = 'assign_later',
    "target_confidence" = 'low',
    "target_reason" = 'This is a profile-level positioning preference, not a claim-specific evidence gap.',
    "expected_outcome" = 'clarify_assignment',
    "updated_at" = now()
  WHERE
    "source_type" = 'resume_review'
    AND "status" IN ('open', 'answered')
    AND (
      "prompt" ~* '(future roles?|future software engineering roles?|career direction|general profile|profile positioning|technical skills section)'
      OR (
        "prompt" ~* '(future|target|preferred|preference|emphasize|emphasized|highlight|positioning|direction|strongest|most recent|recent|prioritize|focus)'
        AND "prompt" ~* '(skills?|technical skills?|skills section|listed skills?|profile|career|software engineering roles?|engineering roles?|role direction|target roles?)'
        AND "prompt" ~* '(which|what|where|how|would you|do you want|should)'
      )
    )
  RETURNING "id"
)
DELETE FROM "enrichment_task_targets"
WHERE "task_id" IN (SELECT "id" FROM repaired_tasks);
