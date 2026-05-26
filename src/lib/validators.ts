import { z } from "zod";
import {
  crowdLevels,
  flagReasons,
  lineStatuses,
  normalizeHashtagName,
  parkingStatuses,
  questionTypes,
  reportCategories,
  weatherFeels,
} from "./domain.ts";

export const coordinateSchema = z.object({
  latitude: z.number().min(33).max(39),
  longitude: z.number().min(124).max(132),
});

export const createReportSchema = z.object({
  placeId: z.string().min(1).max(80),
  category: z.enum(reportCategories),
  crowdLevel: z.enum(crowdLevels),
  lineStatus: z.enum(lineStatuses),
  parkingStatus: z.enum(parkingStatuses),
  weatherFeel: z.enum(weatherFeels),
  comment: z.string().trim().max(120).optional(),
  photoUrl: z.string().url().max(2_048).optional(),
  clientLocation: coordinateSchema.optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const listReportsSchema = z.object({
  placeId: z.string().min(1).max(80).optional(),
  includeExpired: z.coerce.boolean().optional().default(false),
});

const hashtagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((value) => normalizeHashtagName(value))
  .refine((value) => value.length > 0, "해시태그는 한글, 영문, 숫자, 밑줄만 사용할 수 있습니다.");

export const createPostSchema = z.object({
  placeId: z.string().min(1).max(80),
  crowdLevel: z.enum(crowdLevels),
  lineStatus: z.enum(lineStatuses),
  parkingStatus: z.enum(parkingStatuses),
  weatherFeel: z.enum(weatherFeels),
  caption: z.string().trim().max(120).optional(),
  photoCount: z.number().int().min(0).max(4).default(0),
  hashtagNames: z.array(hashtagNameSchema).max(5).default([]),
  clientLocation: coordinateSchema.optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const listPostsSchema = z.object({
  placeId: z.string().min(1).max(80).optional(),
  hashtagName: hashtagNameSchema.optional(),
  includeHidden: z.coerce.boolean().optional().default(false),
});

export const createQuestionSchema = z.object({
  placeId: z.string().min(1).max(80),
  questionType: z.enum(questionTypes),
  body: z.string().trim().min(4).max(160),
  availableCredits: z.number().int().min(0).max(999).default(3),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const flagReportSchema = z.object({
  reportId: z.string().min(1).max(80),
  reason: z.enum(flagReasons),
  note: z.string().trim().max(200).optional(),
});

export type FlagReportInput = z.infer<typeof flagReportSchema>;

export const flagPostSchema = z.object({
  postId: z.string().min(1).max(80),
  reason: z.enum(flagReasons),
  note: z.string().trim().max(200).optional(),
});

export type FlagPostInput = z.infer<typeof flagPostSchema>;
