import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

export type ResumeExportFormat = "markdown" | "json" | "docx" | "html";
export type ResumeExportTemplate = "plain_ats";
export type ResumePagePolicy = "one_page" | "two_page" | "unrestricted";

export type ResumeExportInput = {
  title: string;
  resumeJson?: Record<string, unknown> | null;
  resumeMarkdown: string;
};

export type ResumeExportSection = {
  title: string;
  body: string[];
  bullets: string[];
};

export type ResumeExportViewModel = {
  title: string;
  sections: ResumeExportSection[];
};

export type ResumeExportTrimMetadata = {
  hiddenBodyLines: number;
  hiddenBullets: number;
  hiddenSections: number;
  pagePolicy: ResumePagePolicy;
  wasTrimmed: boolean;
};

export type ResumePagePolicyResult = {
  trim: ResumeExportTrimMetadata;
  viewModel: ResumeExportViewModel;
};

const defaultTemplate: ResumeExportTemplate = "plain_ats";
const defaultPagePolicy: ResumePagePolicy = "unrestricted";

export function parseResumeExportFormat(value: string | null | undefined): ResumeExportFormat | null {
  if (value === "markdown" || value === "json" || value === "docx" || value === "html") {
    return value;
  }
  return null;
}

export function parseResumeExportTemplate(value: string | null | undefined): ResumeExportTemplate {
  return value === "plain_ats" ? value : defaultTemplate;
}

export function parseResumePagePolicy(value: string | null | undefined): ResumePagePolicy {
  if (value === "one_page" || value === "two_page" || value === "unrestricted") {
    return value;
  }
  return defaultPagePolicy;
}

export function getResumeExportContentType(format: ResumeExportFormat) {
  if (format === "json") return "application/json; charset=utf-8";
  if (format === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (format === "html") return "text/html; charset=utf-8";
  return "text/markdown; charset=utf-8";
}

export function makeResumeExportFilename(title: string, format: ResumeExportFormat) {
  const safeTitle =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "resume";
  const extension = format === "markdown" ? "md" : format;
  return `${safeTitle}.${extension}`;
}

export function buildResumeExportViewModel(args: ResumeExportInput): ResumeExportViewModel {
  const structuredSections = extractStructuredSections(args.resumeJson);
  return {
    title: args.title,
    sections: structuredSections.length > 0
      ? structuredSections
      : extractMarkdownSections(args.resumeMarkdown),
  };
}

export function applyResumePagePolicy(
  viewModel: ResumeExportViewModel,
  pagePolicy: ResumePagePolicy,
): ResumePagePolicyResult {
  if (pagePolicy === "unrestricted") {
    return {
      trim: {
        hiddenBodyLines: 0,
        hiddenBullets: 0,
        hiddenSections: 0,
        pagePolicy,
        wasTrimmed: false,
      },
      viewModel,
    };
  }
  const maxBulletsPerSection = pagePolicy === "one_page" ? 4 : 7;
  const maxBodyLinesPerSection = pagePolicy === "one_page" ? 2 : 4;
  const maxSections = pagePolicy === "one_page" ? 5 : 8;
  let hiddenBodyLines = 0;
  let hiddenBullets = 0;
  const keptSections = viewModel.sections.slice(0, maxSections);
  const hiddenSections = viewModel.sections.slice(maxSections);
  for (const section of keptSections) {
    hiddenBodyLines += Math.max(section.body.length - maxBodyLinesPerSection, 0);
    hiddenBullets += Math.max(section.bullets.length - maxBulletsPerSection, 0);
  }
  for (const section of hiddenSections) {
    hiddenBodyLines += section.body.length;
    hiddenBullets += section.bullets.length;
  }
  const trim = {
    hiddenBodyLines,
    hiddenBullets,
    hiddenSections: hiddenSections.length,
    pagePolicy,
    wasTrimmed: hiddenSections.length > 0 || hiddenBodyLines > 0 || hiddenBullets > 0,
  };
  return {
    trim,
    viewModel: {
      ...viewModel,
      sections: keptSections.map((section) => ({
        ...section,
        body: section.body.slice(0, maxBodyLinesPerSection),
        bullets: section.bullets.slice(0, maxBulletsPerSection),
      })),
    },
  };
}

export function makeResumeTrimHeaders(trim: ResumeExportTrimMetadata) {
  return {
    "X-Resume-Export-Hidden-Body-Lines": String(trim.hiddenBodyLines),
    "X-Resume-Export-Hidden-Bullets": String(trim.hiddenBullets),
    "X-Resume-Export-Hidden-Sections": String(trim.hiddenSections),
    "X-Resume-Export-Page-Policy": trim.pagePolicy,
    "X-Resume-Export-Trimmed": trim.wasTrimmed ? "true" : "false",
  };
}

export function renderPlainAtsHtml(args: {
  viewModel: ResumeExportViewModel;
  pagePolicy?: ResumePagePolicy;
  template?: ResumeExportTemplate;
}) {
  const { viewModel } = applyResumePagePolicy(args.viewModel, args.pagePolicy ?? defaultPagePolicy);
  const body = viewModel.sections
    .map((section) => {
      const bodyLines = section.body.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
      const bullets = section.bullets.length
        ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`
        : "";
      return `<section><h2>${escapeHtml(section.title)}</h2>${bodyLines}${bullets}</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(viewModel.title)}</title>
  <style>
    :root { color-scheme: light; }
    body { color: #111827; font-family: Arial, Helvetica, sans-serif; line-height: 1.35; margin: 0; }
    main { margin: 0 auto; max-width: 760px; padding: 36px 42px; }
    h1 { font-size: 24px; letter-spacing: 0; margin: 0 0 18px; text-align: center; }
    h2 { border-bottom: 1px solid #d1d5db; font-size: 13px; letter-spacing: 0; margin: 18px 0 8px; padding-bottom: 4px; text-transform: uppercase; }
    p { margin: 0 0 6px; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 0 0 5px; }
    @media print {
      @page { margin: 0.55in; }
      main { max-width: none; padding: 0; }
      h2 { break-after: avoid; }
      li { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(viewModel.title)}</h1>
    ${body}
  </main>
</body>
</html>`;
}

export async function renderPlainAtsDocx(args: {
  viewModel: ResumeExportViewModel;
  pagePolicy?: ResumePagePolicy;
  template?: ResumeExportTemplate;
}) {
  const { viewModel } = applyResumePagePolicy(args.viewModel, args.pagePolicy ?? defaultPagePolicy);
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: viewModel.title, bold: true, size: 28 })],
    }),
  ];

  for (const section of viewModel.sections) {
    children.push(
      new Paragraph({
        spacing: { before: 180, after: 80 },
        children: [new TextRun({ text: section.title.toUpperCase(), bold: true, size: 22 })],
      }),
    );
    for (const line of section.body) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: line, size: 20 })],
        }),
      );
    }
    for (const bullet of section.bullets) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: [new TextRun({ text: bullet, size: 20 })],
        }),
      );
    }
  }

  const document = new Document({
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}

function extractStructuredSections(resumeJson: Record<string, unknown> | null | undefined) {
  const sections = Array.isArray(resumeJson?.sections) ? resumeJson.sections : [];
  return sections
    .map((section, index): ResumeExportSection | null => {
      if (!isRecord(section)) return null;
      const title = toText(section.title ?? section.heading ?? section.name) ?? `Section ${index + 1}`;
      const bullets = toStringArray(section.bullets ?? section.items);
      const body = toStringArray(section.body ?? section.lines ?? section.content);
      return normalizeSection({ title, body, bullets });
    })
    .filter((section): section is ResumeExportSection => Boolean(section));
}

function extractMarkdownSections(markdown: string) {
  const sections: ResumeExportSection[] = [];
  let current: ResumeExportSection | null = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (current) sections.push(normalizeSection(current));
      current = { title: heading[1]!.trim(), body: [], bullets: [] };
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (!current) current = { title: "Summary", body: [], bullets: [] };
    if (bullet) current.bullets.push(bullet[1]!.trim());
    else current.body.push(line);
  }
  if (current) sections.push(normalizeSection(current));
  return sections.length > 0 ? sections : [{ title: "Resume", body: [markdown.trim()], bullets: [] }];
}

function normalizeSection(section: ResumeExportSection) {
  return {
    title: section.title.trim(),
    body: uniqueClean(section.body),
    bullets: uniqueClean(section.bullets),
  };
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item)) return toText(item.text ?? item.title ?? item.summary ?? item.description) ?? "";
        return "";
      })
      .filter(Boolean);
  }
  const single = toText(value);
  return single ? [single] : [];
}

function uniqueClean(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function toText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
