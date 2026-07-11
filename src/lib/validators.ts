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

const publicHttpUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "공개 URL은 http 또는 https만 사용할 수 있습니다.");

export const createReportSchema = z
  .object({
    placeId: z.string().min(1).max(80),
    category: z.enum(reportCategories),
    crowdLevel: z.enum(crowdLevels).optional(),
    lineStatus: z.enum(lineStatuses).optional(),
    queueStatus: z.enum(["none", "under_10", "10_to_30", "30_to_60", "60_plus"]).optional(),
    parkingStatus: z.enum(parkingStatuses).optional(),
    parkingObservation: z.enum(["available", "limited", "almost_full", "full", "closed"]).optional(),
    weatherFeel: z.enum(weatherFeels).optional(),
    localConditions: z.array(z.enum(["rain", "snow", "strong_wind", "slippery", "entry_restricted", "event", "temporary_closed"])).max(7).optional(),
    comment: z.string().trim().max(120).optional(),
    photoUrl: publicHttpUrlSchema.optional(),
    clientLocation: coordinateSchema.optional(),
  })
  .refine(
    (input) => Boolean(
      input.crowdLevel
      || input.lineStatus
      || input.queueStatus
      || input.parkingStatus
      || input.parkingObservation
      || input.weatherFeel
      || input.localConditions?.length,
    ),
    { message: "실제로 확인한 현장 상태를 하나 이상 선택해 주세요." },
  );

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const listPlacesSchema = z.object({
  regionId: z.string().trim().min(1).max(40).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

export const listReportsSchema = z.object({
  placeId: z.string().min(1).max(80).optional(),
  regionId: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
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
  regionId: z.string().trim().min(1).max(40).optional(),
  hashtagName: hashtagNameSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  includeHidden: z.coerce.boolean().optional().default(false),
});

export const listQuestionsSchema = z.object({
  placeId: z.string().min(1).max(80).optional(),
  regionId: z.string().trim().min(1).max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
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

export const moderatePostActions = ["keep", "hide", "delete", "restrict_author"] as const;

export const moderatePostSchema = z.object({
  postId: z.string().trim().min(1).max(80),
  action: z.enum(moderatePostActions),
});

export type ModeratePostInput = z.infer<typeof moderatePostSchema>;
