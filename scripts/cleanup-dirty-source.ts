import { Client } from "pg";

import { loadDotEnv } from "../src/ai/env";

type Args = {
  apply: boolean;
  title: string;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const titleIndex = args.indexOf("--title");
  const title = titleIndex >= 0 ? args[titleIndex + 1]?.trim() : "";
  if (!title) {
    throw new Error("Usage: tsx scripts/cleanup-dirty-source.ts --title <source title> [--apply]");
  }
  return {
    apply: args.includes("--apply"),
    title,
  };
}

async function main() {
  loadDotEnv();
  const { apply, title } = parseArgs();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("begin");
    const sourceDocumentIds = await ids(
      client,
      "select id from source_documents where title = $1",
      [title],
    );
    const resumeSourceIds = await ids(
      client,
      `
        select id from resume_source_versions
        where title = $1
           or source_document_id = any($2::uuid[])
      `,
      [title, sourceDocumentIds],
    );
    const resumeReviewReportIds = await ids(
      client,
      `
        select id from resume_review_reports
        where resume_source_version_id = any($1::uuid[])
      `,
      [resumeSourceIds],
    );
    const workExperienceIds = await ids(
      client,
      "select id from work_experiences where source_document_id = any($1::uuid[])",
      [sourceDocumentIds],
    );
    const initiativeIds = await ids(
      client,
      `
        select id from initiatives
        where source_document_id = any($1::uuid[])
           or work_experience_id = any($2::uuid[])
      `,
      [sourceDocumentIds, workExperienceIds],
    );
    const portfolioProjectIds = await ids(
      client,
      "select id from portfolio_projects where source_document_id = any($1::uuid[])",
      [sourceDocumentIds],
    );
    const evidenceItemIds = await ids(
      client,
      `
        select id from evidence_items
        where source_document_id = any($1::uuid[])
           or related_work_experience_id = any($2::uuid[])
           or related_initiative_id = any($3::uuid[])
           or related_portfolio_project_id = any($4::uuid[])
      `,
      [sourceDocumentIds, workExperienceIds, initiativeIds, portfolioProjectIds],
    );
    const profileIds = await ids(
      client,
      "select id from profiles where source_document_id = any($1::uuid[])",
      [sourceDocumentIds],
    );
    const enrichmentTaskIds = await ids(
      client,
      `
        select id from enrichment_tasks
        where source_label = $1
           or source_label ilike $2
           or resume_source_version_id = any($3::uuid[])
           or resume_review_report_id = any($4::uuid[])
           or evidence_item_id = any($5::uuid[])
           or work_experience_id = any($6::uuid[])
           or initiative_id = any($7::uuid[])
           or portfolio_project_id = any($8::uuid[])
      `,
      [
        title,
        `%${title}%`,
        resumeSourceIds,
        resumeReviewReportIds,
        evidenceItemIds,
        workExperienceIds,
        initiativeIds,
        portfolioProjectIds,
      ],
    );

    const plan = {
      enrichmentTasks: enrichmentTaskIds.length,
      evidenceItems: evidenceItemIds.length,
      initiatives: initiativeIds.length,
      portfolioProjects: portfolioProjectIds.length,
      profiles: profileIds.length,
      resumeReviewReports: resumeReviewReportIds.length,
      resumeSources: resumeSourceIds.length,
      sourceDocuments: sourceDocumentIds.length,
      title,
    };

    if (!apply) {
      console.log(JSON.stringify({ mode: "dry-run", plan }, null, 2));
      await client.query("rollback");
      return;
    }

    await deleteByIds(client, "enrichment_tasks", enrichmentTaskIds);
    await deleteByIds(client, "evidence_items", evidenceItemIds);
    await deleteByIds(client, "initiatives", initiativeIds);
    await deleteByIds(client, "portfolio_projects", portfolioProjectIds);
    await deleteByIds(client, "profiles", profileIds);
    await deleteByIds(client, "resume_review_reports", resumeReviewReportIds);
    await deleteByIds(client, "resume_source_versions", resumeSourceIds);
    await deleteByIds(client, "source_documents", sourceDocumentIds);
    await client.query("commit");
    console.log(JSON.stringify({ mode: "applied", plan }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function ids(client: Client, sql: string, params: unknown[]) {
  const result = await client.query<{ id: string }>(sql, params);
  return result.rows.map((row) => row.id);
}

async function deleteByIds(client: Client, tableName: string, targetIds: string[]) {
  if (targetIds.length === 0) return;
  await client.query(`delete from ${tableName} where id = any($1::uuid[])`, [targetIds]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
