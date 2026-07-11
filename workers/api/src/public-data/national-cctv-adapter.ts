import {
  PublicDataGatewayError,
  fetchJsonSource,
  type AdapterHealthResult,
  type PublicDataAdapter,
} from "./gateway.ts";

export type NationalCctvQuery = {
  roadType: "ex" | "its";
  cctvType: "1" | "2" | "3" | "4" | "5";
  bbox: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
};

type NationalCctvItem = {
  roadSectionId: string;
  fileCreatedAt: string;
  cctvType: string;
  cctvResolution?: string;
  longitude: string;
  latitude: string;
  cctvFormat?: string;
  cctvName: string;
};

export type NationalCctvResponse = {
  response: {
    header: { resultCode: string; resultMsg: string };
    data: Array<{
      roadsectionid: string;
      filecreatetime: string;
      cctvtype: string;
      cctvurl?: string;
      cctvresolution?: string;
      coordx: string | number;
      coordy: string | number;
      cctvformat?: string;
      cctvname: string;
    }>;
  };
};

export type NormalizedNationalCctvMetadata = {
  externalId: string;
  name: string;
  roadSectionId: string;
  cctvType: string;
  cctvResolution?: string;
  cctvFormat?: string;
  latitude: number;
  longitude: number;
  sourceUpdatedAt: string;
  rightsStatus: "playback_prohibited_unless_licensed";
  playbackAllowed: false;
  sourceKey: "national_cctv";
  sourceType: "official_static";
  sourceName: "국가교통정보센터 CCTV 메타데이터";
  attributionText: "국토교통부";
};

export type NationalCctvAdapterOptions = {
  serviceKey: string;
  now?: () => Date;
};

const endpoint = "https://openapi.its.go.kr:9443/cctvInfo";
const attribution = "국가교통정보센터 CCTV 메타데이터";

export function createNationalCctvAdapter(
  options: NationalCctvAdapterOptions,
): PublicDataAdapter<NationalCctvQuery, { response: { header: { resultCode: string; resultMsg: string }; data: NationalCctvItem[] } }, NormalizedNationalCctvMetadata> {
  const serviceKey = options.serviceKey.trim();
  const now = options.now ?? (() => new Date());
  if (!serviceKey) throw new Error("National CCTV service key is required");

  const adapter: PublicDataAdapter<NationalCctvQuery, { response: { header: { resultCode: string; resultMsg: string }; data: NationalCctvItem[] } }, NormalizedNationalCctvMetadata> = {
    sourceKey: "national_cctv",

    validateQuery(query) {
      if (query.roadType !== "ex" && query.roadType !== "its") throw new Error("invalid roadType");
      if (!(["1", "2", "3", "4", "5"] as const).includes(query.cctvType)) throw new Error("invalid cctvType");
      validateBbox(query.bbox);
    },

    cacheKey(query) {
      return `${query.roadType}:${query.cctvType}:${bboxKey(query.bbox)}`;
    },

    async fetch(query, context) {
      const url = new URL(endpoint);
      url.searchParams.set("apiKey", serviceKey);
      url.searchParams.set("type", query.roadType);
      url.searchParams.set("cctvType", query.cctvType);
      url.searchParams.set("getType", "json");
      appendBbox(url, query.bbox);
      return fetchJsonSource(url, context);
    },

    validateResponse(raw) {
      if (!isRecord(raw) || !isRecord(raw.response) || !isRecord(raw.response.header) || !Array.isArray(raw.response.data)) {
        throw new Error("missing response");
      }
      const header = raw.response.header;
      if (String(header.resultCode) !== "0" || typeof header.resultMsg !== "string") throw new Error("provider error");
      const data = raw.response.data.map(validateCctvItem);
      return { response: { header: { resultCode: String(header.resultCode), resultMsg: header.resultMsg }, data } };
    },

    normalize(raw) {
      return raw.response.data.map((item) => {
        const sourceUpdatedAt = parseCompactKoreaTimestamp(item.fileCreatedAt);
        if (!sourceUpdatedAt) throw new Error("invalid CCTV source time");
        const longitude = coordinate(item.longitude, -180, 180);
        const latitude = coordinate(item.latitude, -90, 90);
        return {
          externalId: `${item.roadSectionId}:${longitude.toFixed(6)}:${latitude.toFixed(6)}`,
          name: item.cctvName,
          roadSectionId: item.roadSectionId,
          cctvType: item.cctvType,
          ...(item.cctvResolution ? { cctvResolution: item.cctvResolution } : {}),
          ...(item.cctvFormat ? { cctvFormat: item.cctvFormat } : {}),
          latitude,
          longitude,
          sourceUpdatedAt: sourceUpdatedAt.toISOString(),
          rightsStatus: "playback_prohibited_unless_licensed" as const,
          playbackAllowed: false as const,
          sourceKey: "national_cctv" as const,
          sourceType: "official_static" as const,
          sourceName: attribution,
          attributionText: "국토교통부" as const,
        };
      });
    },

    getObservedAt() {
      return null;
    },

    getExpiresAt() {
      return null;
    },

    getAttribution() {
      return attribution;
    },

    async healthCheck(query, context): Promise<AdapterHealthResult> {
      const startedAt = Date.now();
      try {
        adapter.validateQuery(query);
        adapter.validateResponse(await adapter.fetch(query, context));
        return { status: "healthy", checkedAt: now().toISOString(), responseTimeMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: error instanceof PublicDataGatewayError && error.code === "SOURCE_QUOTA_EXCEEDED" ? "degraded" : "down",
          checkedAt: now().toISOString(),
          responseTimeMs: Date.now() - startedAt,
          message: "National CCTV source check failed",
        };
      }
    },
  };

  return adapter;
}

function validateCctvItem(value: unknown): NationalCctvItem {
  if (
    !isRecord(value) ||
    !nonEmpty(value.roadsectionid) ||
    !nonEmpty(value.filecreatetime) ||
    !nonEmpty(value.cctvtype) ||
    !nonEmpty(value.cctvname)
  ) {
    throw new Error("invalid CCTV item");
  }
  const longitude = stringOrNumber(value.coordx);
  const latitude = stringOrNumber(value.coordy);
  coordinate(longitude, -180, 180);
  coordinate(latitude, -90, 90);
  if (!parseCompactKoreaTimestamp(value.filecreatetime)) throw new Error("invalid CCTV source time");
  for (const field of ["cctvurl", "cctvresolution", "cctvformat"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new Error("invalid CCTV field");
  }

  return {
    roadSectionId: value.roadsectionid,
    fileCreatedAt: value.filecreatetime,
    cctvType: value.cctvtype,
    longitude,
    latitude,
    cctvName: value.cctvname,
    ...(typeof value.cctvresolution === "string" && value.cctvresolution ? { cctvResolution: value.cctvresolution } : {}),
    ...(typeof value.cctvformat === "string" && value.cctvformat ? { cctvFormat: value.cctvformat } : {}),
  };
}

function validateBbox(bbox: NationalCctvQuery["bbox"]): void {
  const { minLng, maxLng, minLat, maxLat } = bbox;
  if (
    ![minLng, maxLng, minLat, maxLat].every(Number.isFinite) ||
    minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90 ||
    minLng >= maxLng || minLat >= maxLat
  ) {
    throw new Error("invalid bbox");
  }
}

function appendBbox(url: URL, bbox: NationalCctvQuery["bbox"]): void {
  url.searchParams.set("minX", String(bbox.minLng));
  url.searchParams.set("maxX", String(bbox.maxLng));
  url.searchParams.set("minY", String(bbox.minLat));
  url.searchParams.set("maxY", String(bbox.maxLat));
}

function bboxKey(bbox: NationalCctvQuery["bbox"]): string {
  return [bbox.minLng, bbox.maxLng, bbox.minLat, bbox.maxLat].map((value) => value.toFixed(6)).join(":");
}

function parseCompactKoreaTimestamp(value: string): Date | null {
  if (!/^\d{14}$/.test(value)) return null;
  const parsed = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function coordinate(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error("invalid coordinate");
  return parsed;
}

function stringOrNumber(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("invalid coordinate");
  return String(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
