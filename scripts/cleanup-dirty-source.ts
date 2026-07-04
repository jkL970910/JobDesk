import { Client } from "pg";

import { loadDotEnv } from "../src/ai/env";

type Args = {
  apply: boolean;
  deleteSource: boolean;
  resumeSourceVersionId: string | null;
  sourceDocumentId: string | null;
  title: string | null;
};

type Row = Record<string, unknown>;

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const getValue = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1]?.trim() || null : null;
  };
  const resumeSourceVersionId = getValue("--resume-source-version-id");
  const sourceDocumentId = getValue("--source-document-id");
  const title = getValue("--title");
  if (!resumeSourceVersionId && !sourceDocumentId && !title) {
    throw new Error(
      [
        "Usage:",
        "  tsx scripts/cleanup-dirty-source.ts --resume-source-version-id <uuid> [--apply] [--delete-source]",
        "  tsx scripts/cleanup-dirty-source.ts --source-document-id <uuid> [--apply] [--delete-source]",
        "  tsx scripts/cleanup-dirty-source.ts --title <exact source title> [--apply] [--delete-source]",
        "",
        "Default is dry-run and keeps the uploaded/reviewed resume source so it can be re-extracted.",
      ].join("\n"),
    );
  }
  return {
    apply: args.includes("--apply"),
    deleteSource: args.includes("--delete-source"),
    resumeSourceVersionId,
    sourceDocumentId,
    title,
  };
}

async function main() {
  loadDotEnv();
  const args = parseArgs();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("begin");
    const sourceDocuments = await findSourceDocuments(client, args);
    if (sourceDocuments.length === 0) {
      throw new Error("No matching source document was found.");
    }
    if (args.title && !args.resumeSourceVersionId && !args.sourceDocumentId && sourceDocuments.length > 1) {
      throw new Error(
        `Title matched ${sourceDocuments.length} source documents. Re-run with --source-document-id or --resume-source-version-id.`,
      );
    }

    const sourceDocumentIds = sourceDocuments.map((row) => String(row.id));
    const workspaceIds = unique(sourceDocuments.map((row) => String(row.workspace_id)));
    if (workspaceIds.length !== 1) {
      throw new Error("Matched source documents span multiple workspaces; use an exact source id.");
    }
    const workspaceId = workspaceIds[0]!;
    const resumeSources = await rows(
      client,
      `
        select id, title, status, source_document_id
        from resume_source_versions
        where workspace_id = $1
          and (
            id = coalesce($2::uuid, id)
            or source_document_id = any($3::uuid[])
          )
        order by created_at
      `,
      [workspaceId, args.resumeSourceVersionId, sourceDocumentIds],
    );
    const resumeSourceIds = resumeSources.map((row) => String(row.id));
    const resumeReviewReportIds = await ids(
      client,
      `
        select id
        from resume_review_reports
        where workspace_id = $1
          and resume_source_version_id = any($2::uuid[])
      `,
      [workspaceId, resumeSourceIds],
    );
    const workflowRunIds = await ids(
      client,
      `
        select id
        from workflow_runs
        where workspace_id = $1
          and (
            skill_metadata->>'resumeSourceVersionId' = any($2::text[])
            or id in (
              select workflow_run_id
              from profile_evidence_extraction_runs
              where workspace_id = $1
                and (
                  resume_source_version_id = any($2::uuid[])
                  or source_document_id = any($3::uuid[])
                )
                and workflow_run_id is not null
            )
          )
      `,
      [workspaceId, resumeSourceIds, sourceDocumentIds],
    );
    const extractionRunIds = await ids(
      client,
      `
        select id
        from profile_evidence_extraction_runs
        where workspace_id = $1
          and (
            resume_source_version_id = any($2::uuid[])
            or source_document_id = any($3::uuid[])
          )
      `,
      [workspaceId, resumeSourceIds, sourceDocumentIds],
    );
    const workExperienceIds = await ids(
      client,
      `
        select id
        from work_experiences
        where workspace_id = $1
          and source_document_id = any($2::uuid[])
      `,
      [workspaceId, sourceDocumentIds],
    );
    const initiativeIds = await ids(
      client,
      `
        select id
        from initiatives
        where workspace_id = $1
          and (
            source_document_id = any($2::uuid[])
            or work_experience_id = any($3::uuid[])
          )
      `,
      [workspaceId, sourceDocumentIds, workExperienceIds],
    );
    const portfolioProjectIds = await ids(
      client,
      `
        select id
        from portfolio_projects
        where workspace_id = $1
          and source_document_id = any($2::uuid[])
      `,
      [workspaceId, sourceDocumentIds],
    );
    const evidenceItems = await rows(
      client,
      `
        select id, status, allowed_usage, text
        from evidence_items
        where workspace_id = $1
          and (
            source_document_id = any($2::uuid[])
            or related_work_experience_id = any($3::uuid[])
            or related_initiative_id = any($4::uuid[])
            or related_portfolio_project_id = any($5::uuid[])
          )
        order by created_at
      `,
      [workspaceId, sourceDocumentIds, workExperienceIds, initiativeIds, portfolioProjectIds],
    );
    const evidenceItemIds = evidenceItems.map((row) => String(row.id));
    const profileIds = await ids(
      client,
      `
        select id
        from profiles
        where workspace_id = $1
          and source_document_id = any($2::uuid[])
      `,
      [workspaceId, sourceDocumentIds],
    );
    const profileFactHistoryIds = await ids(
      client,
      `
        select id
        from profile_fact_history
        where workspace_id = $1
          and (
            profile_id = any($2::uuid[])
            or source_document_id = any($3::uuid[])
          )
      `,
      [workspaceId, profileIds, sourceDocumentIds],
    );
    const enrichmentTaskIds = await ids(
      client,
      `
        select id
        from enrichment_tasks
        where workspace_id = $1
          and (
            resume_source_version_id = any($2::uuid[])
            or resume_review_report_id = any($3::uuid[])
            or evidence_item_id = any($4::uuid[])
            or work_experience_id = any($5::uuid[])
            or initiative_id = any($6::uuid[])
            or portfolio_project_id = any($7::uuid[])
            or (
              source_type = 'extraction_note'
              and source_label = any($8::text[])
            )
          )
      `,
      [
        workspaceId,
        resumeSourceIds,
        resumeReviewReportIds,
        evidenceItemIds,
        workExperienceIds,
        initiativeIds,
        portfolioProjectIds,
        sourceDocuments.map((row) => String(row.title)),
      ],
    );
    const generatedClaimIds = await ids(
      client,
      `
        select id
        from generated_claims
        where workspace_id = $1
          and exists (
            select 1
            from jsonb_array_elements_text(evidence_ids) evidence_id
            where evidence_id = any($2::text[])
          )
      `,
      [workspaceId, evidenceItemIds],
    );

    const plan = {
      action: args.deleteSource ? "rollback-source-and-delete-upload" : "rollback-source-materials",
      apply: args.apply,
      deleteSource: args.deleteSource,
      evidenceSummary: summarizeEvidence(evidenceItems),
      generatedClaimsToMarkStale: generatedClaimIds.length,
      ids: {
        enrichmentTasks: enrichmentTaskIds,
        evidenceItems: evidenceItemIds,
        extractionRuns: extractionRunIds,
        generatedClaims: generatedClaimIds,
        initiatives: initiativeIds,
        portfolioProjects: portfolioProjectIds,
        profileFactHistory: profileFactHistoryIds,
        profiles: profileIds,
        resumeReviewReports: args.deleteSource ? resumeReviewReportIds : [],
        resumeSources: args.deleteSource ? resumeSourceIds : [],
        sourceDocuments: args.deleteSource ? sourceDocumentIds : [],
        workExperiences: workExperienceIds,
        workflowRuns: workflowRunIds,
      },
      mode: args.apply ? "apply" : "dry-run",
      resumeSources: resumeSources.map((row) => ({
        id: row.id,
        sourceDocumentId: row.source_document_id,
        status: row.status,
        title: row.title,
      })),
      sourceDocuments: sourceDocuments.map((row) => ({
        id: row.id,
        title: row.title,
        workspaceId: row.workspace_id,
      })),
    };

    if (!args.apply) {
      console.log(JSON.stringify(plan, null, 2));
      await client.query("rollback");
      return;
    }

    await markGeneratedClaimsStale(client, generatedClaimIds);
    await deleteByIds(client, "enrichment_tasks", enrichmentTaskIds);
    await deleteByIds(client, "evidence_items", evidenceItemIds);
    await deleteByIds(client, "initiatives", initiativeIds);
    await deleteByIds(client, "portfolio_projects", portfolioProjectIds);
    await deleteByIds(client, "work_experiences", workExperienceIds);
    await deleteByIds(client, "profile_fact_history", profileFactHistoryIds);
    await deleteByIds(client, "profiles", profileIds);
    await deleteByIds(client, "profile_evidence_extraction_runs", extractionRunIds);
    await deleteByIds(client, "workflow_runs", workflowRunIds);
    if (args.deleteSource) {
      await deleteByIds(client, "resume_review_reports", resumeReviewReportIds);
      await deleteByIds(client, "resume_source_versions", resumeSourceIds);
      await deleteByIds(client, "source_documents", sourceDocumentIds);
    } else {
      await resetResumeSourcesForReExtraction(client, resumeSourceIds);
      await resetSourceDocumentsForReExtraction(client, sourceDocumentIds);
    }

    await client.query("commit");
    console.log(JSON.stringify(plan, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function findSourceDocuments(client: Client, args: Args) {
  if (args.sourceDocumentId) {
    return rows(
      client,
      `
        select id, workspace_id, title
        from source_documents
        where id = $1
      `,
      [args.sourceDocumentId],
    );
  }
  if (args.resumeSourceVersionId) {
    return rows(
      client,
      `
        select sd.id, sd.workspace_id, sd.title
        from source_documents sd
        join resume_source_versions rsv on rsv.source_document_id = sd.id
        where rsv.id = $1
      `,
      [args.resumeSourceVersionId],
    );
  }
  return rows(
    client,
    `
      select id, workspace_id, title
      from source_documents
      where title = $1
      order by created_at desc
    `,
    [args.title],
  );
}

function summarizeEvidence(evidenceItems: Row[]) {
  const approved = evidenceItems.filter((row) => row.status === "approved");
  const resumeReady = evidenceItems.filter((row) =>
    Array.isArray(row.allowed_usage) && row.allowed_usage.includes("resume"),
  );
  return {
    approved: approved.length,
    pendingOrRejected: evidenceItems.length - approved.length,
    resumeReady: resumeReady.length,
    total: evidenceItems.length,
  };
}

async function markGeneratedClaimsStale(client: Client, claimIds: string[]) {
  if (claimIds.length === 0) return;
  await client.query(
    `
      update generated_claims
      set claim_status = 'stale',
          support_status = 'unvalidated',
          stale_reason = 'Evidence source was rolled back by cleanup-dirty-source script.',
          last_validated_at = null
      where id = any($1::uuid[])
    `,
    [claimIds],
  );
}

async function resetResumeSourcesForReExtraction(client: Client, resumeSourceIds: string[]) {
  if (resumeSourceIds.length === 0) return;
  await client.query(
    `
      update resume_source_versions
      set status = 'reviewed',
          extracted_at = null,
          updated_at = now()
      where id = any($1::uuid[])
    `,
    [resumeSourceIds],
  );
}

async function resetSourceDocumentsForReExtraction(client: Client, sourceDocumentIds: string[]) {
  if (sourceDocumentIds.length === 0) return;
  await client.query(
    `
      update source_documents
      set lifecycle_status = 'reviewed',
          updated_at = now()
      where id = any($1::uuid[])
    `,
    [sourceDocumentIds],
  );
}

async function ids(client: Client, sql: string, params: unknown[]) {
  const result = await client.query<{ id: string }>(sql, params);
  return result.rows.map((row) => row.id);
}

async function rows(client: Client, sql: string, params: unknown[]) {
  const result = await client.query<Row>(sql, params);
  return result.rows;
}

async function deleteByIds(client: Client, tableName: string, targetIds: string[]) {
  if (targetIds.length === 0) return;
  await client.query(`delete from ${tableName} where id = any($1::uuid[])`, [targetIds]);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
