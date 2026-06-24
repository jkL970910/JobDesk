import { z } from "zod";

const trimmedText = z.string().trim().max(500);
const optionalTrimmedText = trimmedText.optional();
const listPatchMode = z.enum(["append", "replace"]).default("append");

export const ProfileFactField = z.enum([
  "certifications",
  "contact",
  "education",
  "location",
  "skills",
]);
export type ProfileFactField = z.infer<typeof ProfileFactField>;

export const ContactFactPatch = z.object({
  name: optionalTrimmedText,
  email: optionalTrimmedText,
  phone: optionalTrimmedText,
  location: optionalTrimmedText,
  links: z.array(trimmedText.min(1)).max(12).optional(),
});
export type ContactFactPatch = z.infer<typeof ContactFactPatch>;

export const EducationFactPatchItem = z.object({
  institution: trimmedText.min(1),
  degree: trimmedText.min(1),
  fieldOfStudy: optionalTrimmedText,
  startDate: optionalTrimmedText,
  endDate: optionalTrimmedText,
});
export type EducationFactPatchItem = z.infer<typeof EducationFactPatchItem>;

export const ProfileFactPatchRequest = z.discriminatedUnion("field", [
  z.object({
    field: z.literal("contact"),
    contact: ContactFactPatch,
    taskId: z.string().uuid().optional(),
  }),
  z.object({
    field: z.literal("location"),
    location: trimmedText.min(1),
    taskId: z.string().uuid().optional(),
  }),
  z.object({
    field: z.literal("education"),
    education: z.array(EducationFactPatchItem).max(20),
    mode: listPatchMode.optional(),
    taskId: z.string().uuid().optional(),
  }),
  z.object({
    field: z.literal("skills"),
    skills: z.array(trimmedText.min(1)).max(200),
    mode: listPatchMode.optional(),
    taskId: z.string().uuid().optional(),
  }),
  z.object({
    field: z.literal("certifications"),
    certifications: z.array(trimmedText.min(1)).max(100),
    mode: listPatchMode.optional(),
    taskId: z.string().uuid().optional(),
  }),
]);
export type ProfileFactPatchRequest = z.infer<typeof ProfileFactPatchRequest>;

export function buildProfileFactPatchFromText(
  field: ProfileFactField,
  draft: string,
  options: { mode?: "append" | "replace"; taskId?: string | null } = {},
): ProfileFactPatchRequest | null {
  const lines = draft
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const values = parseLabelledDraft(lines);
  const base = options.taskId ? { taskId: options.taskId } : {};
  const listMode = options.mode ? { mode: options.mode } : {};
  if (field === "contact") {
    const links = [
      values.linkedin,
      values.portfolio,
      values.github,
      values["portfolio / github"],
      values["portfolio / github / personal site"],
    ].filter((value): value is string => Boolean(value));
    const contact = compactObject({
      email: values.email,
      links,
      location: values["city / region"] ?? values.location,
      name: values.name,
      phone: values.phone,
    });
    return Object.keys(contact).length > 0 ? { ...base, field: "contact", contact } : null;
  }
  if (field === "location") {
    const location = [
      values["city / region"] ?? values.city ?? values.location,
      values.country,
    ]
      .filter(Boolean)
      .join(", ");
    const detail = values["remote / relocation preference"] ?? values["remote / relocation preference, if relevant"];
    const combined = [location, detail].filter(Boolean).join(" · ");
    return combined ? { ...base, field: "location", location: combined } : null;
  }
  if (field === "education") {
    const institution = values.school ?? values.institution ?? values.university ?? values.college;
    const degree = values["degree / program"] ?? values.degree ?? values.program;
    if (!institution && !degree) return null;
    return {
      ...base,
      field: "education",
      ...listMode,
      education: [
        {
          degree: degree ?? "Education details",
          endDate: values["graduation date"],
          fieldOfStudy: values["field of study"] ?? values.major,
          institution: institution ?? "School not specified",
          startDate: values["start date"],
        },
      ],
    };
  }
  if (field === "certifications") {
    const certification =
      values["certification name"] ??
      values.certification ??
      values.name ??
      lines.find((line) => !line.includes(":"));
    if (!certification) return null;
    const detail = [
      certification,
      values.issuer ? `Issuer: ${values.issuer}` : null,
      values["date earned"] ? `Earned: ${values["date earned"]}` : null,
      values.expiration ? `Expires: ${values.expiration}` : null,
      values["credential url / id"] ? `Credential: ${values["credential url / id"]}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { ...base, field: "certifications", ...listMode, certifications: [detail] };
  }
  const skills = lines.flatMap((line) => {
    const value = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
    return value
      .split(/[;,]/)
      .map((part) => part.trim())
      .filter(Boolean);
  });
  return skills.length > 0 ? { ...base, field: "skills", ...listMode, skills } : null;
}

function parseLabelledDraft(lines: string[]) {
  const values: Record<string, string> = {};
  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value) continue;
    values[key] = value;
  }
  return values;
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (Array.isArray(entry)) return entry.length > 0;
      return entry !== undefined && entry !== null && entry !== "";
    }),
  ) as Partial<T>;
}
