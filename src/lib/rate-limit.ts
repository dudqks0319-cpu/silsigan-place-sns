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

export async function rateLimitKey(request: Request, scope: string) {
  const forwarded = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]
    ?? request.headers.get("x-real-ip")
    ?? "local";
  const input = new TextEncoder().encode(`silsigan-rate-limit:${forwarded.trim()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  const fingerprint = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${scope}:ip:${fingerprint}`;
}

export function clearRateLimitBucketsForTests() {
  buckets.clear();
}
