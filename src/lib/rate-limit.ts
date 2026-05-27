import { ApiError } from "./errors.ts";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateBucket = {
  count: number;
  resetsAt: number;
};

const buckets = new Map<string, RateBucket>();

export function assertRateLimit({ key, limit, windowMs }: RateLimitOptions) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetsAt <= now) {
    buckets.set(key, {
      count: 1,
      resetsAt: now + windowMs,
    });
    return;
  }

  if (bucket.count >= limit) {
    throw new ApiError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)),
    });
  }

  bucket.count += 1;
}

export function rateLimitKey(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const userAgent = request.headers.get("user-agent")?.slice(0, 80) ?? "unknown";

  return `${scope}:${forwarded || realIp || "local"}:${userAgent}`;
}

export function clearRateLimitBucketsForTests() {
  buckets.clear();
}
