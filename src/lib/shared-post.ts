import type { CrowdLevel, LineStatus, ParkingStatus, ShareCard, StoredPost } from "./domain.ts";
import { store } from "./store.ts";

export type SharedPost = Pick<
  StoredPost,
  "id" | "hiddenAt" | "locationVerified" | "photoLabel" | "crowdLevel" | "parkingStatus" | "lineStatus"
> & {
  shareCard: ShareCard;
};

type SharedPostLookupEnv = Record<string, string | undefined>;
type SharedPostLookupOptions = {
  env?: SharedPostLookupEnv;
  fetcher?: typeof fetch;
};

export async function findSharedPost(postId: string, options: SharedPostLookupOptions = {}): Promise<SharedPost | null> {
  const workerBaseUrl = sharedPostWorkerBaseUrl(options.env);

  if (workerBaseUrl) {
    return findWorkerSharedPost(postId, workerBaseUrl, options.fetcher ?? fetch);
  }

  return findDemoSharedPost(postId);
}

async function findWorkerSharedPost(postId: string, baseUrl: string, fetcher: typeof fetch): Promise<SharedPost | null> {
  const url = new URL("/api/posts", `${baseUrl}/`);
  url.searchParams.set("limit", "200");

  try {
    const response = await fetcher(url, {
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
      return null;
    }

    return payload.data.find((candidate): candidate is SharedPost => isSharedPost(candidate) && candidate.id === postId) ?? null;
  } catch {
    return null;
  }
}

async function findDemoSharedPost(postId: string): Promise<SharedPost | null> {
  return (await store.listPosts()).find((candidate) => candidate.id === postId) ?? null;
}

function sharedPostWorkerBaseUrl(env: SharedPostLookupEnv = process.env): string {
  return (env.SILSIGAN_WORKER_API_BASE_URL ?? env.SILSIGAN_STAGING_API_BASE_URL ?? env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function isSharedPost(value: unknown): value is SharedPost {
  if (!isRecord(value) || !isRecord(value.shareCard)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    (typeof value.hiddenAt === "string" || value.hiddenAt === null) &&
    typeof value.locationVerified === "boolean" &&
    typeof value.photoLabel === "string" &&
    isCrowdLevel(value.crowdLevel) &&
    isParkingStatus(value.parkingStatus) &&
    isLineStatus(value.lineStatus) &&
    typeof value.shareCard.headline === "string" &&
    typeof value.shareCard.body === "string" &&
    typeof value.shareCard.url === "string" &&
    Array.isArray(value.shareCard.hashtags) &&
    value.shareCard.hashtags.every((tag) => typeof tag === "string") &&
    isShareCardVariant(value.shareCard.variant)
  );
}

function isCrowdLevel(value: unknown): value is CrowdLevel {
  return value === "quiet" || value === "normal" || value === "busy" || value === "packed";
}

function isParkingStatus(value: unknown): value is ParkingStatus {
  return value === "available" || value === "limited" || value === "full" || value === "unknown";
}

function isLineStatus(value: unknown): value is LineStatus {
  return value === "none" || value === "short" || value === "medium" || value === "long";
}

function isShareCardVariant(value: unknown): value is ShareCard["variant"] {
  return value === "avoid" || value === "good" || value === "parking_full" || value === "waiting" || value === "photo_spot";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
