import { z } from "zod";
import { DEFAULT_REGION_ID, isSupportedRegionId } from "./regions.ts";

export const localLiveQuerySchema = z.object({
  region: z.string().max(32).default(DEFAULT_REGION_ID).refine(isSupportedRegionId, "지원하는 지역을 선택해 주세요."),
  category: z.enum(["all", "attraction", "restaurant", "cafe", "parking", "family"]).default("all"),
  q: z.string().trim().max(80).default(""),
}).strict();

export function parseLocalLiveQuery(url: URL) {
  return localLiveQuerySchema.parse(Object.fromEntries(url.searchParams));
}
