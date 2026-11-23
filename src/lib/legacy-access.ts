import { ApiError } from "./errors.ts";

type Environment = Record<string, string | undefined>;

export const COMMUNITY_POST_MAX_AGE_MS = 3 * 60 * 60_000;

/** The old anonymous write APIs may only exercise the in-memory local demo. */
export function isLegacyDemoEnabled(env: Environment = process.env): boolean {
  const driver = env.SILSIGAN_STORE_DRIVER ?? "demo";
  return env.SILSIGAN_ENABLE_LEGACY_DEMO_WRITES === "true"
    && env.NODE_ENV !== "production"
    && !env.VERCEL
    && (driver === "demo" || driver === "mock");
}

export function assertLegacyWriteAllowed(env: Environment = process.env): void {
  if (!isLegacyDemoEnabled(env)) {
    throw new ApiError(403, "LEGACY_WRITE_DISABLED", "지역 정보 베타에서는 제보와 질문 작성을 지원하지 않습니다.");
  }
}

/** Existing real reports remain opt-in until provenance and moderation are reviewed. */
export function isCommunityReadEnabled(env: Environment = process.env): boolean {
  return env.SILSIGAN_STORE_DRIVER === "supabase" && env.LOCAL_LIVE_COMMUNITY_ENABLED === "true";
}

export function isRecentPublicPost(post: { createdAt: string; hiddenAt?: string | null }, now = new Date()): boolean {
  const createdAt = Date.parse(post.createdAt);
  const age = now.getTime() - createdAt;
  return !post.hiddenAt && Number.isFinite(age) && age >= 0 && age < COMMUNITY_POST_MAX_AGE_MS;
}

export const legacyUnavailableMeta = {
  status: "unavailable",
  live: false,
  source: "legacy-demo",
  message: "이전 데모 데이터는 실제 현장 정보로 제공하지 않습니다.",
} as const;

export const legacyDemoMeta = {
  status: "demo",
  live: false,
  source: "legacy-demo",
  message: "개발 환경의 예시 데이터이며 실제 현장 정보가 아닙니다.",
} as const;
