/**
 * Profile schema (Component 1: Profile Intake).
 * The canonical, source-of-truth representation of the user, with every field
 * bound to its source quote. Skill ref: skills/profile-extraction.
 */
import { z } from "zod";
import { ExtractedField } from "./shared.js";

export const EducationItem = z.object({
  institution: ExtractedField,
  degree: ExtractedField,
  field_of_study: ExtractedField.nullable().default(null),
  start_date: ExtractedField.nullable().default(null),
  end_date: ExtractedField.nullable().default(null),
});
export type EducationItem = z.infer<typeof EducationItem>;

export const ExperienceItem = z.object({
  employer: ExtractedField,
  title: ExtractedField,
  start_date: ExtractedField,
  end_date: ExtractedField,
  bullets: z.array(ExtractedField).default([]),
});
export type ExperienceItem = z.infer<typeof ExperienceItem>;

export const Contact = z.object({
  name: ExtractedField,
  email: ExtractedField.nullable().default(null),
  phone: ExtractedField.nullable().default(null),
  location: ExtractedField.nullable().default(null),
  links: z.array(ExtractedField).default([]),
});
export type Contact = z.infer<typeof Contact>;

export const Profile = z.object({
  contact: Contact,
  education: z.array(EducationItem).default([]),
  experience: z.array(ExperienceItem).default([]),
  skills: z.array(ExtractedField).default([]),
  certifications: z.array(ExtractedField).default([]),
  // Review-surface arrays populated by the intake pipeline:
  missing_fields: z.array(z.string()).default([]),
  low_confidence_fields: z.array(z.string()).default([]),
  invented_field_flags: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof Profile>;
