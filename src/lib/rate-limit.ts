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
const bucketCapacity = 4_096;
const expiredBucketSweepInterval = 128;
let checksSinceExpiredBucketSweep = 0;

export function assertRateLimit({ key, limit, windowMs }: RateLimitOptions) {
  const now = Date.now();
  sweepExpiredBucketsWhenDue(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetsAt <= now) {
    if (bucket) {
      buckets.delete(key);
    }
    ensureBucketCapacity(now);
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
  const cloudflareIp = normalizedClientHeader(request.headers.get("cf-connecting-ip"));
  if (cloudflareIp) {
    return `${scope}:cf:${cloudflareIp}`;
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const fallbackIp = normalizedClientHeader(forwarded) ?? normalizedClientHeader(realIp) ?? "untrusted";

  return `${scope}:fallback:${fallbackIp}`;
}

export function clearRateLimitBucketsForTests() {
  buckets.clear();
  checksSinceExpiredBucketSweep = 0;
}

export function rateLimitDiagnosticsForTests() {
  return {
    capacity: bucketCapacity,
    size: buckets.size,
  };
}

function normalizedClientHeader(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.slice(0, 64);
}

function sweepExpiredBucketsWhenDue(now: number) {
  checksSinceExpiredBucketSweep += 1;
  if (checksSinceExpiredBucketSweep < expiredBucketSweepInterval) return;

  deleteExpiredBuckets(now);
  checksSinceExpiredBucketSweep = 0;
}

function ensureBucketCapacity(now: number) {
  if (buckets.size < bucketCapacity) return;

  deleteExpiredBuckets(now);
  if (buckets.size < bucketCapacity) return;

  throw new ApiError(429, "RATE_LIMIT_CAPACITY_REACHED", "요청 보호 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.", {
    retryAfterSeconds: 60,
  });
}

function deleteExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetsAt <= now) {
      buckets.delete(key);
    }
  }
}
