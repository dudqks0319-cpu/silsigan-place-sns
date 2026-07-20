import type { CrowdLevel, LineStatus, ParkingStatus, ShareCard, StoredPost } from "./domain.ts";
import type { CloudflarePlaceStatus } from "./cloudflare-api.ts";
import { store } from "./store.ts";

export type ShareStatusSnapshot = Pick<
  CloudflarePlaceStatus,
  "dataMode" | "status" | "currentSignals" | "independentSourceCount" | "confidenceScore" | "reasonCodes" | "observedAt" | "computedAt"
>;

export type SharedPost = Pick<
  StoredPost,
  "id" | "placeId" | "hiddenAt" | "locationVerified" | "photoLabel" | "crowdLevel" | "parkingStatus" | "lineStatus"
> & {
  shareCard: ShareCard;
  status?: ShareStatusSnapshot;
  observedAt: string;
  thumbnail: ApprovedShareThumbnail | null;
};

export type ApprovedShareThumbnail = {
  url: string;
  alt: string;
  moderationStatus: "approved";
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
  const url = new URL(`/api/share/posts/${encodeURIComponent(postId)}`, `${baseUrl}/`);

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
    if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
      return null;
    }

    return normalizeSharedPost(payload.data, postId, new URL(baseUrl).origin);
  } catch {
    return null;
  }
}

async function findDemoSharedPost(postId: string): Promise<SharedPost | null> {
  const post = (await store.listPosts()).find((candidate) => candidate.id === postId);
  return post ? normalizeSharedPost(post, postId) : null;
}

function sharedPostWorkerBaseUrl(env: SharedPostLookupEnv = process.env): string {
  return (env.SILSIGAN_WORKER_API_BASE_URL ?? env.SILSIGAN_STAGING_API_BASE_URL ?? env.NEXT_PUBLIC_CLOUDFLARE_API_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function normalizeSharedPost(value: unknown, expectedPostId: string, workerOrigin?: string): SharedPost | null {
  if (!isRecord(value) || !isRecord(value.shareCard)) {
    return null;
  }

  if (!(
    value.id === expectedPostId &&
    isSafePlaceId(value.placeId) &&
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
    isShareCardVariant(value.shareCard.variant) &&
    (value.status === undefined || isShareStatus(value.status))
  )) {
    return null;
  }

  const status = value.status as ShareStatusSnapshot | undefined;
  const observedAt = validIsoTimestamp(status?.observedAt) ?? validIsoTimestamp(value.createdAt);
  if (!observedAt) {
    return null;
  }

  const localPlacePath = `/place/${encodeURIComponent(value.placeId)}`;
  const shareCardUrl = safeShareCardUrl(value.shareCard.url, value.placeId) ?? localPlacePath;

  return {
    id: value.id,
    placeId: value.placeId,
    hiddenAt: value.hiddenAt,
    locationVerified: value.locationVerified,
    photoLabel: value.photoLabel,
    crowdLevel: value.crowdLevel,
    parkingStatus: value.parkingStatus,
    lineStatus: value.lineStatus,
    shareCard: {
      headline: value.shareCard.headline,
      body: value.shareCard.body,
      url: shareCardUrl,
      hashtags: value.shareCard.hashtags,
      variant: value.shareCard.variant,
    },
    status,
    observedAt,
    thumbnail: approvedThumbnail(value.thumbnail, workerOrigin),
  };
}

export function isSafePlaceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value);
}

function safeShareCardUrl(value: string, placeId: string): string | null {
  try {
    const url = new URL(value);
    const expectedPath = `/place/${encodeURIComponent(placeId)}`;
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== expectedPath) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function approvedThumbnail(value: unknown, workerOrigin?: string): ApprovedShareThumbnail | null {
  if (!workerOrigin || !isRecord(value) || value.moderationStatus !== "approved" || typeof value.url !== "string" || typeof value.alt !== "string") {
    return null;
  }

  try {
    const url = new URL(value.url);
    const alt = value.alt.trim().slice(0, 160);
    if (!alt || url.protocol !== "https:" || url.origin !== workerOrigin || url.username || url.password || url.search || url.hash) {
      return null;
    }

    return {
      url: url.toString(),
      alt,
      moderationStatus: "approved",
    };
  } catch {
    return null;
  }
}

function validIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    return null;
  }

  return value;
}

function isShareStatus(value: unknown): value is ShareStatusSnapshot {
  if (!isRecord(value) || (value.dataMode !== "live" && value.dataMode !== "demo")) {
    return false;
  }

  return (
    value.status === "likely_good" ||
    value.status === "check_before_visit" ||
    value.status === "likely_crowded" ||
    value.status === "insufficient"
  ) &&
    Array.isArray(value.currentSignals) &&
    value.currentSignals.every((signal) => isRecord(signal) && typeof signal.sourceName === "string" && typeof signal.observedAt === "string") &&
    typeof value.independentSourceCount === "number" &&
    typeof value.confidenceScore === "number" &&
    Array.isArray(value.reasonCodes) &&
    value.reasonCodes.every((reason) => typeof reason === "string") &&
    (typeof value.observedAt === "string" || value.observedAt === null) &&
    typeof value.computedAt === "string";
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
  return value === "neutral";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
