export type ScopedApiPathOptions = {
  regionId?: string | null;
  placeId?: string | null;
  hashtagName?: string | null;
  q?: string | null;
  bbox?: string | null;
  limit?: number | null;
};

const maxApiLimit = 200;

export function normalizeRegionScope(regionId: string | null | undefined) {
  const normalized = regionId?.trim();

  if (!normalized || normalized === "nationwide") {
    return undefined;
  }

  return normalized;
}

export function clampApiLimit(limit: number | null | undefined, fallback = 100) {
  if (!Number.isFinite(limit)) {
    return fallback;
  }

  return Math.min(maxApiLimit, Math.max(1, Math.trunc(limit ?? fallback)));
}

export function buildScopedApiPath(path: string, options: ScopedApiPathOptions = {}) {
  const params = new URLSearchParams();
  const regionId = normalizeRegionScope(options.regionId);
  const placeId = options.placeId?.trim();
  const hashtagName = options.hashtagName?.trim();
  const query = options.q?.trim();
  const bbox = options.bbox?.trim();

  if (regionId) {
    params.set("regionId", regionId);
  }

  if (placeId) {
    params.set("placeId", placeId);
  }

  if (hashtagName) {
    params.set("hashtagName", hashtagName);
  }

  if (query) {
    params.set("q", query);
  }

  if (bbox) {
    params.set("bbox", bbox);
  }

  if (options.limit !== undefined && options.limit !== null) {
    params.set("limit", String(clampApiLimit(options.limit)));
  }

  const queryString = params.toString();

  return queryString ? `${path}?${queryString}` : path;
}
