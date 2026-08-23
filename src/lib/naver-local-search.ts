import { z } from "zod";
import { ApiError } from "./errors.ts";

const naverLocalSearchItemSchema = z.object({
  title: z.string().max(500).optional(),
  category: z.string().max(500).optional(),
  roadAddress: z.string().max(500).optional(),
  address: z.string().max(500).optional(),
  mapx: z.union([z.string().max(40), z.number().finite()]).optional(),
  mapy: z.union([z.string().max(40), z.number().finite()]).optional(),
  link: z.string().max(2_048).optional(),
}).passthrough();

const naverLocalSearchPayloadSchema = z.object({
  items: z.array(naverLocalSearchItemSchema).max(5),
}).passthrough();

export type NaverLocalSearchResult = {
  title: string;
  category: string;
  roadAddress: string;
  address: string;
  mapx: string;
  mapy: string;
  link: string;
};

export type NaverLocalSearchPayload = {
  items: NaverLocalSearchResult[];
  coordinateNote: string;
};

type NaverLocalSearchCacheEntry = {
  expiresAt: number;
  value: Promise<NaverLocalSearchPayload>;
};

const naverLocalSearchCache = new Map<string, NaverLocalSearchCacheEntry>();
const naverLocalSearchCacheTtlMs = 5 * 60_000;
const naverLocalSearchCacheMaxEntries = 200;

const coordinateNote = "Naver local search mapx/mapy 좌표계는 지도 표시 전 Maps Geocoder/좌표 변환으로 검증해야 합니다.";

export function normalizeNaverLocalSearchPayload(input: unknown): NaverLocalSearchPayload {
  const parsed = naverLocalSearchPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(502, "NAVER_SEARCH_SHAPE_INVALID", "네이버 장소 검색 응답 형식이 올바르지 않습니다.");
  }

  const items = parsed.data.items
    .map((item) => ({
      title: stripHtml(item.title ?? "").trim(),
      category: stripHtml(item.category ?? "").trim(),
      roadAddress: stripHtml(item.roadAddress ?? "").trim(),
      address: stripHtml(item.address ?? "").trim(),
      mapx: String(item.mapx ?? ""),
      mapy: String(item.mapy ?? ""),
      link: normalizeHttpUrl(item.link),
    }))
    .filter((item) => item.title.length > 0);

  return { items, coordinateNote };
}

export async function fetchNaverLocalSearch(
  query: string,
  credentials: { clientId: string; clientSecret: string },
  timeoutMs = 5_000,
): Promise<NaverLocalSearchPayload> {
  const url = new URL("https://openapi.naver.com/v1/search/local.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", "5");
  url.searchParams.set("sort", "comment");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": credentials.clientId,
        "X-Naver-Client-Secret": credentials.clientSecret,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(502, "NAVER_SEARCH_FAILED", "네이버 장소 검색에 실패했습니다.");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(502, "NAVER_SEARCH_SHAPE_INVALID", "네이버 장소 검색 응답 형식이 올바르지 않습니다.");
    }

    return normalizeNaverLocalSearchPayload(payload);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(504, "NAVER_SEARCH_TIMEOUT", "네이버 장소 검색 응답이 늦습니다.");
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(502, "NAVER_SEARCH_FAILED", "네이버 장소 검색에 실패했습니다.");
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchCachedNaverLocalSearch(
  query: string,
  credentials: { clientId: string; clientSecret: string },
  timeoutMs = 5_000,
): Promise<NaverLocalSearchPayload> {
  const normalizedQuery = query.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
  const cacheKey = await sha256Text(normalizedQuery);
  const now = Date.now();
  const cached = naverLocalSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) {
    naverLocalSearchCache.delete(cacheKey);
  }

  while (naverLocalSearchCache.size >= naverLocalSearchCacheMaxEntries) {
    const oldestKey = naverLocalSearchCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    naverLocalSearchCache.delete(oldestKey);
  }

  const value = fetchNaverLocalSearch(normalizedQuery, credentials, timeoutMs);
  naverLocalSearchCache.set(cacheKey, { expiresAt: now + naverLocalSearchCacheTtlMs, value });
  try {
    return await value;
  } catch (error) {
    naverLocalSearchCache.delete(cacheKey);
    throw error;
  }
}

export function clearNaverLocalSearchCacheForTests() {
  naverLocalSearchCache.clear();
}

async function sha256Text(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeHttpUrl(value: string | undefined) {
  if (!value) return "";

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "");
}
