import { z } from "zod";

const trimmedText = z.string().trim().max(500);
const optionalTrimmedText = trimmedText.optional();

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
  }),
  z.object({
    field: z.literal("location"),
    location: trimmedText.min(1),
  }),
  z.object({
    field: z.literal("education"),
    education: z.array(EducationFactPatchItem).max(20),
  }),
  z.object({
    field: z.literal("skills"),
    skills: z.array(trimmedText.min(1)).max(200),
  }),
  z.object({
    field: z.literal("certifications"),
    certifications: z.array(trimmedText.min(1)).max(100),
  }),
]);
export type ProfileFactPatchRequest = z.infer<typeof ProfileFactPatchRequest>;
