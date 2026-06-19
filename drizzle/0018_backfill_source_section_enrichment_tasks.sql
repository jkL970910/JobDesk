UPDATE "enrichment_tasks"
SET
	"task_type" = 'source_section_review'::"enrichment_task_type",
	"target_scope" = 'source_material'::"enrichment_task_target_scope",
	"target_confidence" = 'high'::"enrichment_task_target_confidence",
	"target_reason" = 'This is an extraction note for an imported source section, not a missing-information question.',
	"expected_outcome" = 'review_imported_material'::"enrichment_task_expected_outcome"
WHERE
	"source_type" = 'extraction_note'
	AND (
		"prompt" ILIKE '%entries were extracted from the % section%'
		OR "prompt" ILIKE '%was extracted from the % section%'
		OR "prompt" ILIKE '%were extracted from the % section%'
	);
