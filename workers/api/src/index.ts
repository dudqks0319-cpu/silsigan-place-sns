import {
  type ApiResponse,
  type BBox,
  type LikePolicyState,
  type PlaceRecord,
  type RankingRecord,
  type RateLimitState,
  PHOTO_MAX_BYTES,
  MAX_REGION_RANKING_LIMIT,
  applySlidingWindowRateLimit,
  clampLimit,
  filterPlacesByBBox,
  filterPlacesByRadius,
  intersectBBoxes,
  parseBBox,
  parseRadiusSearch,
  rankRegionPlaces,
  registerUniqueCommentLike,
  registerUniquePlaceLike,
  registerUniquePhotoClick,
  unregisterUniquePlaceLike,
  validatePhotoComplete,
} from "./policies.ts";

declare const WebSocketPair: {
  new (): WebSocketPairResult;
};

type WebSocketPairResult = {
  0: WorkerWebSocket;
  1: WorkerWebSocket;
};

type ExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
};

type WorkerResponseInit = ResponseInit & {
  webSocket?: WorkerWebSocket;
};

type WorkerWebSocket = {
  accept: () => void;
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: "message" | "close" | "error", listener: (event: WebSocketMessageEvent) => void) => void;
  readyState: number;
};

type WebSocketMessageEvent = {
  data: string | ArrayBuffer;
};

type DurableObjectNamespace = {
  idFromName: (name: string) => DurableObjectId;
  get: (id: DurableObjectId) => DurableObjectStub;
};

type DurableObjectId = {
  toString: () => string;
};

type DurableObjectStub = {
  fetch: (request: Request) => Promise<Response>;
};

type R2Bucket = {
  put: (
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectBody | null>;
  delete: (key: string | string[]) => Promise<void>;
};

type R2ObjectBody = {
  body: ReadableStream;
  httpMetadata?: {
    contentType?: string;
  };
};

type ImagesBinding = {
  input: (source: ReadableStream | ArrayBuffer) => ImagesPipeline;
};

type ImagesPipeline = {
  transform: (options: ImagesTransformOptions) => ImagesPipeline;
  output: (options: ImagesOutputOptions) => Promise<ImagesOutput> | ImagesOutput;
};

type ImagesTransformOptions = {
  width: number;
  height: number;
  fit: "scale-down";
};

type ImagesOutputOptions = {
  format: "image/webp" | "image/jpeg";
  quality: number;
  anim: false;
};

type ImagesOutput = {
  response: () => Promise<Response> | Response;
};

type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

type Env = {
  DB?: D1Database;
  PHOTOS?: R2Bucket;
  IMAGES?: ImagesBinding;
  CACHE?: KVNamespace;
  PLACE_ROOM?: DurableObjectNamespace;
  REGION_ROOM?: DurableObjectNamespace;
  GLOBAL_ROOM?: DurableObjectNamespace;
  ADMIN_TOKEN?: string;
  ADMIN_TOKENS?: string;
  MODERATION_ALERT_WEBHOOK_URL?: string;
  MODERATION_ALERT_WEBHOOK_TOKEN?: string;
  ENVIRONMENT?: string;
};

type D1Database = {
  prepare: (query: string) => D1PreparedStatement;
};

type D1PreparedStatement = {
  bind: (...values: D1Value[]) => D1PreparedStatement;
  all: <TRecord>() => Promise<{ results?: TRecord[] }>;
  first: <TRecord>() => Promise<TRecord | null>;
  run: () => Promise<unknown>;
};

type D1Value = string | number | null;

type D1PlaceRow = {
  id: string;
  name: string;
  categoryId: string;
  areaId: string;
  regionId: string;
  latitude: number;
  longitude: number;
  score: number | null;
  status: PlaceRecord["status"];
  coordinateStatus: "verified";
};

type RankingCounts = {
  clickCount: number;
  likeCount: number;
  commentCount: number;
  photoCount: number;
  reportCount: number;
  uniqueUserCount: number;
};

type D1CommentRow = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  body: string;
  likeCount: number;
  hiddenAt: string | null;
  createdAt: string;
};

type D1PhotoRow = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  storageKey: string;
  mimeType: PhotoRecord["mimeType"];
  byteSize: number;
  width: number;
  height: number;
  clickCount: number;
  status: PhotoRecord["status"];
  deletedAt: string | null;
  createdAt: string;
};

type D1ReportRow = {
  id: string;
  targetType: ReportRecord["targetType"];
  targetId: string;
  reason: ReportRecord["reason"];
  anonymousUserId: string;
  note: string | null;
  status: ReportRecord["status"];
  createdAt: string;
};

type D1CountRow = {
  count: number;
};

type AdminModerationAction = "hide" | "restore" | "delete";
type AdminBulkModerationAction = Exclude<AdminModerationAction, "delete">;
type AdminActionType =
  | AdminModerationAction
  | `bulk_${AdminBulkModerationAction}`
  | `report_${ReportRecord["status"]}`
  | "place_coordinate_status"
  | "user_restrict"
  | "user_unrestrict";
type AdminRole = "operator" | "moderator" | "admin";

type AdminCredential = {
  role: AdminRole;
  token: string;
  source: "ADMIN_TOKEN" | "ADMIN_TOKENS";
};

type D1ModerationTarget = {
  exists: boolean;
  storageKey: string | null;
  placeId: string | null;
  regionId: string | null;
};

type CacheInvalidationResult = {
  binding: "CACHE" | "none";
  keys: string[];
  deletedKeys: string[];
};

type JsonObject = Record<string, unknown>;

type RankingCacheEntry = {
  data: RankingRecord[];
  meta: Record<string, unknown>;
};

type RankingRoute = {
  kind: "generic" | "global" | "region" | "area" | "category";
  regionId: string | null;
  areaId: string | null;
  categoryId: string | null;
};

type AdminBulkModerationTarget = {
  targetType: ReportRecord["targetType"];
  targetId: string;
};

type AdminBulkModerationResult = AdminBulkModerationTarget & {
  status: "ok" | "not_found";
};

type D1BlockedUserRow = {
  reason: string;
  blockedUntil: string | null;
};

type ModerationAlertPayload = {
  type: "moderation.report.created";
  reportId: string;
  targetType: ReportRecord["targetType"];
  targetId: string;
  reason: ReportRecord["reason"];
  priority: "normal" | "high" | "urgent";
  queuePath: string;
  environment: string;
  createdAt: string;
};

type AnonymousSession = {
  id: string;
  isNew: boolean;
};

type CommentRecord = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  body: string;
  likeCount: number;
  hiddenAt: string | null;
  createdAt: string;
};

type PhotoRecord = {
  id: string;
  placeId: string;
  anonymousUserId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  clickCount: number;
  status: "pending" | "ready" | "rejected";
  deletedAt: string | null;
  createdAt: string;
};

type PublicPhotoRecord = Pick<
  PhotoRecord,
  "id" | "placeId" | "mimeType" | "byteSize" | "width" | "height" | "clickCount" | "status" | "createdAt"
> & {
  previewUrl: string | null;
};

type DuplicatePhotoRecord = {
  id: string;
  placeId: string;
};

type SanitizedPhoto = {
  bytes: Uint8Array;
  mimeType: PhotoRecord["mimeType"];
  originalBytes: number;
  sanitizedBytes: number;
  metadataRemoved: boolean;
  pixelsReencoded: boolean;
  processing: "worker-metadata-stripped" | "cloudflare-images-reencoded";
};

type ReportRecord = {
  id: string;
  targetType: "place" | "comment" | "photo";
  targetId: string;
  reason: "false_content" | "spam" | "privacy_face" | "privacy_plate" | "sensitive_info" | "other";
  anonymousUserId: string;
  note: string | null;
  status: "open" | "accepted" | "rejected";
  createdAt: string;
};

type RoomBroadcast = {
  type: "place.liked" | "comment.created" | "photo.ready" | "report.created" | "heartbeat";
  scope: "place" | "region" | "global";
  roomId: string;
  payload: JsonObject;
  createdAt: string;
};

const seedPlaces: PlaceRecord[] = [
  {
    id: "busan-gwangalli",
    name: "광안리해수욕장",
    categoryId: "tourism",
    areaId: "busan-suyeong",
    regionId: "busan",
    latitude: 35.1532,
    longitude: 129.1186,
    score: 98,
    status: "active",
    coordinateStatus: "verified",
  },
  {
    id: "ulsan-taehwagang",
    name: "태화강 국가정원",
    categoryId: "tourism",
    areaId: "ulsan-jung",
    regionId: "ulsan",
    latitude: 35.5486,
    longitude: 129.3005,
    score: 84,
    status: "active",
    coordinateStatus: "verified",
  },
  {
    id: "gyeongju-hwangridan",
    name: "황리단길",
    categoryId: "restaurant_cafe",
    areaId: "gyeongju-hwango",
    regionId: "gyeongju",
    latitude: 35.8382,
    longitude: 129.2098,
    score: 91,
    status: "active",
    coordinateStatus: "verified",
  },
  {
    id: "seoul-yeouido",
    name: "여의도 한강공원",
    categoryId: "tourism",
    areaId: "seoul-yeongdeungpo",
    regionId: "seoul",
    latitude: 37.5265,
    longitude: 126.9349,
    score: 88,
    status: "beta",
    coordinateStatus: "verified",
  },
];

const comments: CommentRecord[] = [];
const photos: PhotoRecord[] = [];
const reports: ReportRecord[] = [];
const rateBuckets = new Map<string, RateLimitState>();
const likeStateByAnon = new Map<string, LikePolicyState>();
const placeLikeCounts = new Map<string, number>();
const placeClickCounts = new Map<string, number>();
const placeClickWindowsByAnon = new Map<string, Map<string, number>>();
const roomEvents = new Map<string, RoomBroadcast[]>();
const photoContentHashes = new Map<string, string>();
const commentCreateMinuteLimit = 5;
const commentCreateDailyLimit = 100;
const commentBodyMaxLength = 280;
const commentBodyMinLength = 2;
const oneMinuteMs = 60_000;
const oneDayMs = 24 * 60 * 60_000;
const adminRoles = ["operator", "moderator", "admin"] as const;
const adminRoleRank: Record<AdminRole, number> = {
  operator: 1,
  moderator: 2,
  admin: 3,
};
const REPORT_TTL_MS = 3 * 60 * 60 * 1000;
const RANKING_CACHE_TTL_SECONDS = 60;
const RANKING_CACHE_VERSION_KEY = "rankings:version";
const DEFAULT_RANKING_CACHE_VERSION = "initial";
const D1_NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const D1_ACTIVE_CONTENT_CUTOFF_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours')";

const workerApi = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};

export default workerApi;

export async function handleRequest(request: Request, env: Env = {}, ctx: ExecutionContext = testExecutionContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && path === "/api/health") {
      return json({ ok: true, service: "silsigan-cloudflare-api", storage: env.DB ? "d1" : "memory" });
    }

    const session = getAnonymousSession(request);
    const sessionHeaders = sessionHeadersFor(session);

    if (request.method === "GET" && path === "/api/places") {
      return withHeaders(await listPlaces(url, env), sessionHeaders);
    }

    const placeRouteMatch = path.match(/^\/api\/places\/([^/]+)(?:\/([^/]+))?$/);
    if (placeRouteMatch) {
      const placeId = decodeURIComponent(placeRouteMatch[1]);
      const action = placeRouteMatch[2];

      if (request.method === "GET" && !action) {
        return withHeaders(await getPlace(placeId, env), sessionHeaders);
      }

      if (request.method === "GET" && action === "live") {
        return withHeaders(await getPlaceLive(placeId, env), sessionHeaders);
      }

      if (request.method === "POST" && action === "click") {
        await enforceRateLimit("place:click", request, session.id, 60, 60_000);
        return withHeaders(await clickPlace(placeId, session, env), sessionHeaders);
      }

      if (request.method === "POST" && action === "like") {
        await enforceRateLimit("place:like", request, session.id, 30, 60_000);
        return withHeaders(await likePlace(placeId, session, env, ctx), sessionHeaders);
      }

      if (request.method === "DELETE" && action === "like") {
        return withHeaders(await unlikePlace(placeId, session, env), sessionHeaders);
      }
    }

    if (request.method === "GET" && path.startsWith("/api/rankings")) {
      return withHeaders(await listRankings(url, path, env), sessionHeaders);
    }

    if (path === "/api/comments") {
      if (request.method === "GET") {
        return withHeaders(await listComments(url, env), sessionHeaders);
      }

      if (request.method === "POST") {
        await enforceRateLimit("comment:create:minute", request, session.id, commentCreateMinuteLimit, oneMinuteMs);
        await enforceRateLimit("comment:create:daily", request, session.id, commentCreateDailyLimit, oneDayMs);
        const response = await createComment(request, session, env, ctx);
        return withHeaders(response, sessionHeaders);
      }
    }

    const commentLikeMatch = path.match(/^\/api\/comments\/([^/]+)\/like$/);
    if (commentLikeMatch && request.method === "POST") {
      await enforceRateLimit("comment:like", request, session.id, 30, 60_000);
      return withHeaders(await likeComment(commentLikeMatch[1], session, env), sessionHeaders);
    }

    const commentDeleteMatch = path.match(/^\/api\/comments\/([^/]+)$/);
    if (commentDeleteMatch && request.method === "DELETE") {
      return withHeaders(await deleteComment(commentDeleteMatch[1], session, env), sessionHeaders);
    }

    if (path === "/api/photos" && request.method === "GET") {
      return withHeaders(await listPhotos(url, env), sessionHeaders);
    }

    if (path === "/api/photos/upload-url" && request.method === "POST") {
      await enforceRateLimit("photo:upload-url", request, session.id, 10, 60 * 60_000);
      return withHeaders(await createPhotoUploadUrl(request, session, env), sessionHeaders);
    }

    if (path === "/api/photos/complete" && request.method === "POST") {
      await enforceRateLimit("photo:complete", request, session.id, 10, 60 * 60_000);
      const response = await completePhoto(request, session, env, ctx);
      return withHeaders(response, sessionHeaders);
    }

    const photoFileMatch = path.match(/^\/api\/photos\/([^/]+)\/file$/);
    if (photoFileMatch && request.method === "GET") {
      return withHeaders(await servePhotoFile(photoFileMatch[1], env), sessionHeaders);
    }

    const photoClickMatch = path.match(/^\/api\/photos\/([^/]+)\/click$/);
    if (photoClickMatch && request.method === "POST") {
      await enforceRateLimit("photo:click", request, session.id, 60, 60_000);
      return withHeaders(await clickPhoto(photoClickMatch[1], session, env), sessionHeaders);
    }

    const photoDeleteMatch = path.match(/^\/api\/photos\/([^/]+)$/);
    if (photoDeleteMatch && request.method === "DELETE") {
      return withHeaders(await deletePhoto(photoDeleteMatch[1], session, env), sessionHeaders);
    }

    if (path === "/api/reports" && request.method === "POST") {
      await enforceRateLimit("report:create", request, session.id, 5, 60_000);
      const response = await createReport(request, session, env, ctx);
      return withHeaders(response, sessionHeaders);
    }

    if (path === "/api/moderation/reports" && request.method === "POST") {
      await enforceRateLimit("report:create", request, session.id, 5, 60_000);
      const response = await createReport(request, session, env, ctx);
      return withHeaders(response, sessionHeaders);
    }

    if (path === "/api/moderation/reports" && request.method === "GET") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await listModerationReports(url, env), sessionHeaders);
    }

    const moderationActionMatch = path.match(/^\/api\/moderation\/reports\/([^/]+)\/action$/);
    if (moderationActionMatch && request.method === "POST") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await moderateReport(moderationActionMatch[1], request, env), sessionHeaders);
    }

    if (path === "/api/admin/moderation/bulk" && request.method === "POST") {
      await requireAdmin(request, env, "moderator");
      return withHeaders(await bulkModerateContent(request, env), sessionHeaders);
    }

    if (path === "/api/admin/places/coordinate-status" && request.method === "POST") {
      await requireAdmin(request, env, "operator");
      return withHeaders(await updatePlaceCoordinateStatus(request, env), sessionHeaders);
    }

    if (path === "/api/admin/users/restrict" && request.method === "POST") {
      await requireAdmin(request, env, "admin");
      return withHeaders(await restrictUser(request, env), sessionHeaders);
    }

    if (path === "/api/admin/users/unrestrict" && request.method === "POST") {
      await requireAdmin(request, env, "admin");
      return withHeaders(await unrestrictUser(request, env), sessionHeaders);
    }

    const adminModerationMatch = path.match(/^\/api\/admin\/moderation\/(hide|restore|delete)$/);
    if (adminModerationMatch && request.method === "POST") {
      const action = adminModerationMatch[1] as AdminModerationAction;
      await requireAdmin(request, env, action === "delete" ? "admin" : "moderator");
      return withHeaders(await moderateContent(request, env, action), sessionHeaders);
    }

    const realtimeResponse = routeRealtime(request, env, ctx, url, path);
    if (realtimeResponse) {
      return withHeaders(await realtimeResponse, sessionHeaders);
    }

    return errorResponse(404, "NOT_FOUND", "라우트를 찾을 수 없습니다.");
  } catch (error) {
    return errorToResponse(error);
  }
}

export class PlaceRoom {
  private readonly room = new InMemoryRoom();

  constructor() {}

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "place");
  }
}

export class RegionRoom {
  private readonly room = new InMemoryRoom();

  constructor() {}

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "region");
  }
}

export class GlobalRoom {
  private readonly room = new InMemoryRoom();

  constructor() {}

  async fetch(request: Request): Promise<Response> {
    return this.room.fetch(request, "global");
  }
}

class InMemoryRoom {
  private readonly sockets = new Set<WorkerWebSocket>();
  private readonly eventsByRoom = new Map<string, RoomBroadcast[]>();

  async fetch(request: Request, scope: RoomBroadcast["scope"]): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId") ?? "global";

    if (request.method === "POST" && url.pathname === "/api/realtime/broadcast") {
      const event = roomBroadcastFromUnknown(await readJson(request), scope, roomId);
      const key = roomKey(scope, roomId);
      this.eventsByRoom.set(key, [event, ...(this.eventsByRoom.get(key) ?? [])].slice(0, 50));
      this.broadcast(JSON.stringify(event));

      return json({
        mode: "durable-object",
        scope,
        roomId,
        delivered: this.sockets.size,
      });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      this.sockets.add(server);
      server.addEventListener("message", (event) => {
        const data = typeof event.data === "string" ? event.data : "";
        this.broadcast(
          JSON.stringify({
            type: "heartbeat",
            scope,
            roomId,
            payload: { echo: data.slice(0, 256) },
            createdAt: new Date().toISOString(),
          }),
        );
      });
      server.addEventListener("close", () => this.sockets.delete(server));
      server.addEventListener("error", () => this.sockets.delete(server));

      const responseInit: WorkerResponseInit = {
        status: 101,
        webSocket: client,
      };

      return new Response(null, {
        ...responseInit,
      });
    }

    return json({ mode: "durable-object-polling", scope, roomId, events: this.eventsByRoom.get(roomKey(scope, roomId)) ?? [] });
  }

  private broadcast(message: string) {
    for (const socket of this.sockets) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  }
}

function roomBroadcastFromUnknown(value: unknown, scope: RoomBroadcast["scope"], roomId: string): RoomBroadcast {
  if (!isRecord(value)) {
    throw new HttpError(400, "REALTIME_EVENT_INVALID", "실시간 이벤트 형식이 올바르지 않습니다.");
  }

  const type = value.type;
  const eventScope = value.scope;
  const eventRoomId = value.roomId;
  const payload = value.payload;
  const createdAt = value.createdAt;
  const allowedTypes = new Set<RoomBroadcast["type"]>(["place.liked", "comment.created", "photo.ready", "report.created", "heartbeat"]);

  if (!allowedTypes.has(type as RoomBroadcast["type"]) || eventScope !== scope || eventRoomId !== roomId || !isRecord(payload) || typeof createdAt !== "string") {
    throw new HttpError(400, "REALTIME_EVENT_INVALID", "실시간 이벤트 형식이 올바르지 않습니다.");
  }

  return {
    type: type as RoomBroadcast["type"],
    scope,
    roomId,
    payload,
    createdAt,
  };
}

async function listPlaces(url: URL, env: Env): Promise<Response> {
  const limit = clampLimit(url.searchParams.get("limit"), 200, 100);
  const bbox = parseBBox(url.searchParams.get("bbox"));
  const radiusSearch = parseRadiusSearch(url.searchParams.get("lat"), url.searchParams.get("lng"), url.searchParams.get("radius"));
  const spatialBBox = intersectBBoxes(bbox, radiusSearch?.bbox ?? null);
  const spatialConflict = Boolean(bbox && radiusSearch && !spatialBBox);
  const d1Limit = radiusSearch ? Math.min(200, Math.max(limit * 4, limit)) : limit;
  const regionId = url.searchParams.get("region") ?? url.searchParams.get("regionId");
  const areaId = url.searchParams.get("area") ?? url.searchParams.get("areaId");
  const categoryId = url.searchParams.get("category") ?? url.searchParams.get("categoryId");
  const query = url.searchParams.get("q")?.trim().toLocaleLowerCase("ko-KR");

  if (spatialConflict) {
    return json([], {
      limit,
      bboxApplied: true,
      radiusApplied: true,
      radiusMeters: radiusSearch?.radiusMeters,
      storage: env.DB ? "d1" : "memory-fallback",
    });
  }

  if (env.DB) {
    const { sql, values } = d1PlacesQuery({
      bbox: spatialBBox,
      regionId,
      areaId,
      categoryId,
      query,
      limit: d1Limit,
    });
    const { results = [] } = await env.DB.prepare(sql).bind(...values).all<D1PlaceRow>();
    const filtered = filterPlacesByRadius(results.map(d1PlaceRowToRecord), radiusSearch).slice(0, limit);

    return json(filtered, {
      limit,
      bboxApplied: Boolean(bbox),
      radiusApplied: Boolean(radiusSearch),
      radiusMeters: radiusSearch?.radiusMeters,
      storage: "d1",
    });
  }

  const filtered = filterPlacesByRadius(filterPlacesByBBox(seedPlaces, spatialBBox), radiusSearch)
    .filter((place) => !regionId || place.regionId === regionId)
    .filter((place) => !areaId || place.areaId === areaId)
    .filter((place) => !categoryId || place.categoryId === categoryId)
    .filter((place) => !query || place.name.toLocaleLowerCase("ko-KR").includes(query))
    .slice(0, limit);

  return json(filtered, {
    limit,
    bboxApplied: Boolean(bbox),
    radiusApplied: Boolean(radiusSearch),
    radiusMeters: radiusSearch?.radiusMeters,
    storage: "memory-fallback",
  });
}

async function getPlace(placeId: string, env: Env): Promise<Response> {
  if (env.DB) {
    const row = await env.DB
      .prepare(
        `${d1PlaceSelectSql()}
         WHERE p.id = ? AND p.is_active = 1 AND p.coordinate_status = 'verified' AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
         LIMIT 1`,
      )
      .bind(placeId)
      .first<D1PlaceRow>();

    if (!row) {
      throw new HttpError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다.");
    }

    return json(d1PlaceRowToRecord(row), { source: "d1" });
  }

  return json(findPlaceRecord(placeId), { source: "memory-fallback" });
}

async function getPlaceLive(placeId: string, env: Env): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);

  if (env.DB) {
    const [likeCount, clickCount, commentCount, photoCount, recentReportCount] = await Promise.all([
      countD1Interactions(env.DB, "place", place.id),
      countD1Events(env.DB, place.id, "click"),
      countD1VisibleComments(env.DB, place.id),
      countD1VisiblePhotos(env.DB, place.id),
      countD1OpenReportsForTarget(env.DB, "place", place.id),
    ]);

    return json(
      {
        placeId: place.id,
        statusSummary: d1PlaceStatusSummary(commentCount, photoCount),
        likeCount,
        clickCount,
        commentCount,
        photoCount,
        recentReportCount,
        updatedAt: new Date().toISOString(),
        policy: "실시간 사용자 제보 기반이며 정보가 없으면 정보 없음으로 표시합니다.",
      },
      { source: "d1-user-reports-not-sensor-data" },
    );
  }

  return json(
    {
      placeId: place.id,
      statusSummary: placeStatusSummary(place),
      likeCount: placeLikeCounts.get(place.id) ?? 0,
      clickCount: placeClickCounts.get(place.id) ?? 0,
      commentCount: comments.filter((comment) => comment.placeId === place.id && !comment.hiddenAt && isActiveRecentContent(comment.createdAt)).length,
      photoCount: photos.filter((photo) => photo.placeId === place.id && photo.status === "ready" && !photo.deletedAt && isActiveRecentContent(photo.createdAt)).length,
      recentReportCount: reports.filter((report) => report.targetId === place.id && report.status === "open").length,
      updatedAt: new Date().toISOString(),
      policy: "실시간 사용자 제보 기반이며 정보가 없으면 정보 없음으로 표시합니다.",
    },
    { source: "user-reports-not-sensor-data" },
  );
}

async function clickPlace(placeId: string, session: AnonymousSession, env: Env): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const now = Date.now();
    const userWindows = placeClickWindowsFor(anonymousUserId);
    const previous = userWindows.get(place.id);
    const created = !previous || now - previous >= 5 * 60_000;
    if (created) {
      userWindows.set(place.id, now);
      await recordD1PlaceEvent(env.DB, place, anonymousUserId, "click");
    }
    const clickCount = await countD1Events(env.DB, place.id, "click");

    return json(
      {
        placeId: place.id,
        clickCount,
        created,
      },
      { duplicatePolicy: "same-anonymous-user-place-counts-once-per-5-minutes", storage: "d1" },
    );
  }

  const now = Date.now();
  const userWindows = placeClickWindowsFor(session.id);
  const previous = userWindows.get(place.id);
  const created = !previous || now - previous >= 5 * 60_000;

  if (created) {
    userWindows.set(place.id, now);
    placeClickCounts.set(place.id, (placeClickCounts.get(place.id) ?? 0) + 1);
  }

  return json(
    {
      placeId: place.id,
      clickCount: placeClickCounts.get(place.id) ?? 0,
      created,
    },
    { duplicatePolicy: "same-anonymous-user-place-counts-once-per-5-minutes" },
  );
}

async function likePlace(placeId: string, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const created = await createD1UniqueInteraction(env.DB, anonymousUserId, "place", place.id);
    if (created) {
      await recordD1PlaceEvent(env.DB, place, anonymousUserId, "like");
    }
    const likeCount = await countD1Interactions(env.DB, "place", place.id);
    if (created) {
      ctx.waitUntil(
        broadcastPlaceActivity(env, "place.liked", place, {
          placeId: place.id,
          regionId: place.regionId,
          areaId: place.areaId,
          likeCount,
        }),
      );
    }

    return json({ placeId: place.id, likeCount, created }, { storage: "d1" });
  }

  const created = registerUniquePlaceLike(likeStateFor(session.id), place.id);
  if (created) {
    placeLikeCounts.set(place.id, (placeLikeCounts.get(place.id) ?? 0) + 1);
    ctx.waitUntil(
      broadcastPlaceActivity(env, "place.liked", place, {
        placeId: place.id,
        regionId: place.regionId,
        areaId: place.areaId,
        likeCount: placeLikeCounts.get(place.id) ?? 0,
      }),
    );
  }

  return json({ placeId: place.id, likeCount: placeLikeCounts.get(place.id) ?? 0, created });
}

async function unlikePlace(placeId: string, session: AnonymousSession, env: Env): Promise<Response> {
  const place = await resolvePlaceRecord(placeId, env);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    const existing = await getD1InteractionId(env.DB, anonymousUserId, "place", place.id);
    if (existing) {
      await env.DB.prepare("DELETE FROM likes WHERE id = ?").bind(existing).run();
    }
    const likeCount = await countD1Interactions(env.DB, "place", place.id);

    return json({ placeId: place.id, likeCount, deleted: Boolean(existing) }, { storage: "d1" });
  }

  const deleted = unregisterUniquePlaceLike(likeStateFor(session.id), place.id);
  if (deleted) {
    placeLikeCounts.set(place.id, Math.max(0, (placeLikeCounts.get(place.id) ?? 0) - 1));
  }

  return json({ placeId: place.id, likeCount: placeLikeCounts.get(place.id) ?? 0, deleted });
}

async function rankingCacheKey(
  env: Env,
  route: RankingRoute["kind"],
  regionId: string | null,
  areaId: string | null,
  categoryId: string | null,
  bbox: BBox | null,
  limit: number,
): Promise<string | null> {
  if (!env.CACHE) {
    return null;
  }

  const version = (await env.CACHE.get(RANKING_CACHE_VERSION_KEY)) ?? DEFAULT_RANKING_CACHE_VERSION;
  const bboxPart = bbox ? `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}` : "none";
  const parts = [
    "rankings",
    "v",
    version,
    `route=${route}`,
    `region=${regionId ?? "all"}`,
    `area=${areaId ?? "all"}`,
    `category=${categoryId ?? "all"}`,
    `bbox=${bboxPart}`,
    `limit=${limit}`,
  ];

  return parts.map((part) => encodeURIComponent(part)).join(":");
}

async function readRankingCache(env: Env, cacheKey: string | null): Promise<RankingCacheEntry | null> {
  if (!cacheKey || !env.CACHE) {
    return null;
  }

  const raw = await env.CACHE.get(cacheKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return rankingCacheEntry(parsed);
  } catch {
    return null;
  }
}

async function writeRankingCache(
  env: Env,
  cacheKey: string | null,
  data: RankingRecord[],
  meta: Record<string, unknown>,
): Promise<void> {
  if (!cacheKey || !env.CACHE) {
    return;
  }

  await env.CACHE.put(cacheKey, JSON.stringify({ data, meta }), {
    expirationTtl: RANKING_CACHE_TTL_SECONDS,
  });
}

function rankingCacheEntry(value: unknown): RankingCacheEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const data = value.data;
  const meta = value.meta;
  if (!Array.isArray(data) || !data.every(isRankingRecord) || !isRecord(meta)) {
    return null;
  }

  return { data, meta };
}

function isRankingRecord(value: unknown): value is RankingRecord {
  return (
    isRecord(value) &&
    typeof value.placeId === "string" &&
    typeof value.name === "string" &&
    typeof value.regionId === "string" &&
    typeof value.regionCode === "string" &&
    typeof value.areaCode === "string" &&
    typeof value.category === "string" &&
    typeof value.score === "number" &&
    typeof value.rank === "number" &&
    typeof value.windowHours === "number" &&
    typeof value.clickCount === "number" &&
    typeof value.likeCount === "number" &&
    typeof value.commentCount === "number" &&
    typeof value.photoCount === "number" &&
    typeof value.reportCount === "number" &&
    typeof value.uniqueUserCount === "number" &&
    (value.trend === "up" || value.trend === "down" || value.trend === "same") &&
    typeof value.summary === "string"
  );
}

async function listRankings(url: URL, path: string, env: Env): Promise<Response> {
  const route = parseRankingRoute(path);
  const regionId = route.regionId ?? url.searchParams.get("region") ?? url.searchParams.get("regionId");
  const areaId = route.areaId ?? url.searchParams.get("area") ?? url.searchParams.get("areaId");
  const categoryId = route.categoryId ?? url.searchParams.get("category") ?? url.searchParams.get("categoryId");
  const bbox = parseBBox(url.searchParams.get("bbox"));
  const limit = clampLimit(url.searchParams.get("limit"), MAX_REGION_RANKING_LIMIT, 10);
  const cacheKey = await rankingCacheKey(env, route.kind, regionId, areaId, categoryId, bbox, limit);
  const cached = await readRankingCache(env, cacheKey);
  if (cached) {
    return json(cached.data, {
      ...cached.meta,
      cacheStatus: "hit",
      cacheTtlSeconds: RANKING_CACHE_TTL_SECONDS,
    });
  }

  if (env.DB) {
    const db = env.DB;
    const { sql, values, limit: d1Limit } = d1PlacesQuery({
      bbox,
      regionId,
      areaId,
      categoryId,
      query: null,
      limit,
      requireRankingSignal: true,
    });
    const { results = [] } = await db.prepare(sql).bind(...values).all<D1PlaceRow>();
    const rankings: RankingRecord[] = await Promise.all(
      results.map(async (row, index) => rankingRecordForPlace(d1PlaceRowToRecord(row), index + 1, await d1RankingCounts(db, row.id))),
    );
    const meta = {
      limit: d1Limit,
      regionId: regionId ?? "all",
      areaId: areaId ?? null,
      categoryId: categoryId ?? null,
      route: route.kind,
      storage: "d1",
      cachePolicy: "60s ranking KV cache",
    };
    await writeRankingCache(env, cacheKey, rankings, meta);

    return json(rankings, { ...meta, cacheStatus: cacheKey ? "miss" : "disabled", cacheTtlSeconds: cacheKey ? RANKING_CACHE_TTL_SECONDS : null });
  }

  const scopedPlaces = filterPlacesByBBox(seedPlaces, bbox)
    .filter((place) => !areaId || place.areaId === areaId)
    .filter((place) => !categoryId || place.categoryId === categoryId);
  const ranked = rankRegionPlaces(scopedPlaces, regionId, limit);
  const rankings: RankingRecord[] = ranked.map((place, index) => rankingRecordForPlace(place, index + 1, memoryRankingCounts(place.id)));
  const meta = {
    limit: rankings.length,
    regionId: regionId ?? "all",
    areaId: areaId ?? null,
    categoryId: categoryId ?? null,
    route: route.kind,
    cachePolicy: "60s ranking KV cache",
  };
  await writeRankingCache(env, cacheKey, rankings, meta);

  return json(rankings, { ...meta, cacheStatus: cacheKey ? "miss" : "disabled", cacheTtlSeconds: cacheKey ? RANKING_CACHE_TTL_SECONDS : null });
}

async function listComments(url: URL, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const limit = clampLimit(url.searchParams.get("limit"));
  if (env.DB) {
    const where = ["status = 'visible'", "hidden_at IS NULL", "deleted_at IS NULL", `created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`];
    const values: D1Value[] = [];
    if (placeId) {
      where.push("place_id = ?");
      values.push(placeId);
    }
    values.push(limit);

    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          id,
          place_id AS placeId,
          anonymous_user_id AS anonymousUserId,
          body,
          like_count AS likeCount,
          hidden_at AS hiddenAt,
          created_at AS createdAt
        FROM comments
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1CommentRow>();

    return json(results, { limit, storage: "d1" });
  }

  const data = comments
    .filter((comment) => !comment.hiddenAt)
    .filter((comment) => isActiveRecentContent(comment.createdAt))
    .filter((comment) => !placeId || comment.placeId === placeId)
    .slice(0, limit);

  return json(data, { limit });
}

async function createComment(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const commentBody = commentBodyField(body);
  const place = await resolvePlaceRecord(placeId, env);
  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  const comment: CommentRecord = {
    id: `comment_${crypto.randomUUID()}`,
    placeId,
    anonymousUserId,
    body: commentBody,
    likeCount: 0,
    hiddenAt: null,
    createdAt: new Date().toISOString(),
  };

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO comments
          (id, place_id, anonymous_user_id, body, status, like_count, hidden_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'visible', 0, NULL, ?, ?)`,
      )
      .bind(comment.id, place.id, comment.anonymousUserId, comment.body, comment.createdAt, comment.createdAt)
      .run();
    await recordD1PlaceEvent(env.DB, place, comment.anonymousUserId, "comment");
    ctx.waitUntil(
      broadcastPlaceActivity(env, "comment.created", place, {
        id: comment.id,
        placeId: place.id,
        regionId: place.regionId,
        areaId: place.areaId,
      }),
    );

    return json(comment, { anonymousUserPolicy: "hashed-session-id", storage: "d1" }, 201);
  }

  comments.unshift(comment);
  ctx.waitUntil(
    broadcastPlaceActivity(env, "comment.created", place, {
      id: comment.id,
      placeId: place.id,
      regionId: place.regionId,
      areaId: place.areaId,
    }),
  );

  return json(comment, { anonymousUserPolicy: "header-or-cookie-session" }, 201);
}

async function likeComment(commentId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const comment = await getD1VisibleComment(env.DB, commentId);
    if (!comment) {
      return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const created = await createD1UniqueInteraction(env.DB, anonymousUserId, "comment", commentId);
    const likeCount = await countD1Interactions(env.DB, "comment", commentId);
    if (created) {
      await env.DB.prepare("UPDATE comments SET like_count = ?, updated_at = ? WHERE id = ?").bind(likeCount, new Date().toISOString(), commentId).run();
    }

    return json({ commentId, likeCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once", storage: "d1" });
  }

  const comment = comments.find((candidate) => candidate.id === commentId);
  if (!comment || comment.hiddenAt) {
    return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
  }

  const state = likeStateFor(session.id);
  const created = registerUniqueCommentLike(state, commentId);
  if (created) {
    comment.likeCount += 1;
  }

  return json({ commentId, likeCount: comment.likeCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once" });
}

async function deleteComment(commentId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const comment = await getD1VisibleComment(env.DB, commentId);
    if (!comment) {
      return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    if (comment.anonymousUserId !== anonymousUserId) {
      return errorResponse(403, "COMMENT_DELETE_FORBIDDEN", "내가 작성한 댓글만 삭제할 수 있습니다.");
    }

    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE comments SET status = 'deleted', hidden_at = ?, deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, now, commentId).run();

    return json({ commentId, deleted: true }, { storage: "d1" });
  }

  const comment = comments.find((candidate) => candidate.id === commentId);
  if (!comment || comment.hiddenAt) {
    return errorResponse(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
  }

  if (comment.anonymousUserId !== session.id) {
    return errorResponse(403, "COMMENT_DELETE_FORBIDDEN", "내가 작성한 댓글만 삭제할 수 있습니다.");
  }

  comment.hiddenAt = new Date().toISOString();

  return json({ commentId, deleted: true });
}

async function listPhotos(url: URL, env: Env): Promise<Response> {
  const placeId = url.searchParams.get("placeId");
  const limit = clampLimit(url.searchParams.get("limit"), 20, 20);
  if (env.DB) {
    const where = ["status = 'ready'", "deleted_at IS NULL", "hidden_at IS NULL", `created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`];
    const values: D1Value[] = [];
    if (placeId) {
      where.push("place_id = ?");
      values.push(placeId);
    }
    values.push(limit);

    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          id,
          place_id AS placeId,
          anonymous_user_id AS anonymousUserId,
          r2_key AS storageKey,
          mime_type AS mimeType,
          byte_size AS byteSize,
          width,
          height,
          COALESCE((SELECT COUNT(*) FROM likes l WHERE l.target_type = 'photo' AND l.target_id = photos.id), 0) AS clickCount,
          status,
          deleted_at AS deletedAt,
          created_at AS createdAt
        FROM photos
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1PhotoRow>();

    return json(results.map((photo) => photoToPublicPhoto(photo, url, env)), { limit, order: "latest", storage: "d1" });
  }

  const data = photos
    .filter((photo) => photo.status === "ready" && !photo.deletedAt)
    .filter((photo) => isActiveRecentContent(photo.createdAt))
    .filter((photo) => !placeId || photo.placeId === placeId)
    .slice(0, limit);

  return json(data.map((photo) => photoToPublicPhoto(photo, url, env)), { limit, order: "latest" });
}

function photoToPublicPhoto(photo: PhotoRecord, requestUrl: URL, env: Env): PublicPhotoRecord {
  return {
    id: photo.id,
    placeId: photo.placeId,
    mimeType: photo.mimeType,
    byteSize: photo.byteSize,
    width: photo.width,
    height: photo.height,
    clickCount: photo.clickCount,
    status: photo.status,
    createdAt: photo.createdAt,
    previewUrl: env.PHOTOS ? new URL(`/api/photos/${encodeURIComponent(photo.id)}/file`, requestUrl.origin).toString() : null,
  };
}

async function createPhotoUploadUrl(request: Request, session: AnonymousSession, env: Env): Promise<Response> {
  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 80);
  const mimeType = stringField(body, "mimeType", 40);
  const place = await resolvePlaceRecord(placeId, env);
  if (env.DB) {
    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }
  if (mimeType !== "image/webp" && mimeType !== "image/jpeg") {
    throw new HttpError(400, "PHOTO_MIME_TYPE", "WebP 또는 JPEG 사진만 업로드할 수 있습니다.");
  }

  const now = new Date();
  const uploadId = `upload_${crypto.randomUUID()}`;
  const extension = mimeType === "image/jpeg" ? "jpg" : "webp";
  const storageKey = `photos/${place.regionId}/${place.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${extension}`;

  return json(
    {
      uploadId,
      method: "PUT",
      uploadUrl: "/api/photos/complete",
      storageKey,
      headers: {
        "content-type": mimeType,
        "x-silsigan-anon-id": session.id,
      },
    },
    {
      r2Policy: {
        maxBytes: 3 * 1024 * 1024,
        maxDimension: 1280,
        originalFilenameStored: false,
        gpsExifStripped: true,
        processing: "worker-strips-metadata-before-r2-put",
      },
    },
    201,
  );
}

async function completePhoto(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const uploadId = stringField(body, "uploadId", 100);
  const placeId = stringField(body, "placeId", 80);
  const place = await resolvePlaceRecord(placeId, env);
  const requestedMimeType = stringField(body, "mimeType", 40) as PhotoRecord["mimeType"];
  const requestedByteSize = numberField(body, "byteSize");
  const requestedWidth = numberField(body, "width");
  const requestedHeight = numberField(body, "height");
  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  const result = validatePhotoComplete({
    uploadId,
    placeId,
    regionCode: place.regionId,
    byteSize: requestedByteSize,
    mimeType: requestedMimeType,
    width: requestedWidth,
    height: requestedHeight,
    clientReencoded: booleanField(body, "clientReencoded"),
    originalFilename: optionalStringField(body, "originalFilename", 255),
  });
  const sanitizedPhoto = env.PHOTOS
    ? await processPhotoForR2(
        optionalStringField(body, "imageBase64", Math.ceil(PHOTO_MAX_BYTES * 1.4)) ?? null,
        result.storageKey,
        requestedMimeType,
        requestedWidth,
        requestedHeight,
        env,
      )
    : null;
  const byteSize = sanitizedPhoto?.sanitizedBytes ?? requestedByteSize;
  const mimeType = sanitizedPhoto?.mimeType ?? requestedMimeType;
  const imageHash = sanitizedPhoto ? await photoContentHash(sanitizedPhoto) : null;

  const photo: PhotoRecord = {
    id: `photo_${crypto.randomUUID()}`,
    placeId,
    anonymousUserId,
    storageKey: result.storageKey,
    mimeType,
    byteSize,
    width: requestedWidth,
    height: requestedHeight,
    clickCount: 0,
    status: "ready",
    deletedAt: null,
    createdAt: new Date().toISOString(),
  };

  if (env.PHOTOS) {
    if (!sanitizedPhoto) {
      throw new HttpError(400, "PHOTO_IMAGE_REQUIRED", "R2 저장에는 정화할 이미지 파일이 필요합니다.");
    }

    if (imageHash) {
      const duplicate = env.DB ? await findD1DuplicatePhoto(env.DB, imageHash) : findMemoryDuplicatePhoto(imageHash);
      if (duplicate) {
        throw duplicatePhotoError(duplicate);
      }
    }

    await env.PHOTOS.put(result.storageKey, arrayBufferForBytes(sanitizedPhoto.bytes), {
      httpMetadata: { contentType: photo.mimeType },
      customMetadata: {
        placeId,
        uploadId,
        originalFilenameStored: "false",
        metadataRemoved: sanitizedPhoto.metadataRemoved ? "true" : "none-found",
        serverPixelReencoded: sanitizedPhoto.pixelsReencoded ? "true" : "false",
        gpsExifStripped: "true",
        processing: sanitizedPhoto.processing,
        originalBytes: String(sanitizedPhoto.originalBytes),
        sanitizedBytes: String(sanitizedPhoto.sanitizedBytes),
      },
    });
  }

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO photos
          (id, place_id, anonymous_user_id, r2_key, mime_type, byte_size, width, height, image_hash, duplicate_status, status, deleted_at, hidden_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, NULL, ?)`,
      )
      .bind(
        photo.id,
        photo.placeId,
        photo.anonymousUserId,
        photo.storageKey,
        photo.mimeType,
        photo.byteSize,
        photo.width,
        photo.height,
        imageHash,
        imageHash ? "unique" : "unchecked",
        photo.createdAt,
      )
      .run();
    await recordD1PlaceEvent(env.DB, place, photo.anonymousUserId, "photo");
  } else {
    photos.unshift(photo);
    if (imageHash) {
      photoContentHashes.set(photo.id, imageHash);
    }
  }
  ctx.waitUntil(
    broadcastPlaceActivity(env, "photo.ready", place, {
      id: photo.id,
      placeId: place.id,
      regionId: place.regionId,
      areaId: place.areaId,
    }),
  );

  return json(
    {
      photo,
      storageKey: result.storageKey,
    },
    {
      r2Policy: result.policy,
      storage: env.DB ? "d1" : "memory-fallback",
      duplicatePolicy: imageHash ? "exact-sanitized-content-sha256-blocks-active-duplicates" : "metadata-only-not-checked",
      photoSanitization: sanitizedPhoto
        ? {
            metadataRemoved: sanitizedPhoto.metadataRemoved,
            pixelsReencoded: sanitizedPhoto.pixelsReencoded,
            processing: sanitizedPhoto.processing,
            originalBytes: sanitizedPhoto.originalBytes,
            sanitizedBytes: sanitizedPhoto.sanitizedBytes,
            exifGpsStored: false,
          }
        : {
            metadataOnlyMode: true,
            exifGpsStored: false,
          },
    },
    201,
  );
}

async function processPhotoForR2(
  imageBase64: string | null,
  storageKey: string,
  mimeType: PhotoRecord["mimeType"],
  width: number,
  height: number,
  env: Env,
): Promise<SanitizedPhoto> {
  const metadataStripped = sanitizePhotoForR2(imageBase64, storageKey, mimeType);
  if (!env.IMAGES) {
    return metadataStripped;
  }

  return reencodePhotoWithImagesBinding(metadataStripped, env.IMAGES, width, height);
}

async function photoContentHash(photo: SanitizedPhoto): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBufferForBytes(photo.bytes));
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

async function findD1DuplicatePhoto(db: D1Database, imageHash: string): Promise<DuplicatePhotoRecord | null> {
  return db
    .prepare(
      `SELECT id, place_id AS placeId
       FROM photos
       WHERE image_hash = ?
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(imageHash)
    .first<DuplicatePhotoRecord>();
}

function findMemoryDuplicatePhoto(imageHash: string): DuplicatePhotoRecord | null {
  for (const [photoId, candidateHash] of photoContentHashes.entries()) {
    if (candidateHash !== imageHash) {
      continue;
    }

    const photo = photos.find((candidate) => candidate.id === photoId && !candidate.deletedAt);
    if (photo) {
      return { id: photo.id, placeId: photo.placeId };
    }
  }

  return null;
}

function duplicatePhotoError(duplicate: DuplicatePhotoRecord): HttpError {
  return new HttpError(409, "PHOTO_DUPLICATE", "이미 등록된 사진과 동일한 이미지입니다.", {
    duplicateOfPhotoId: duplicate.id,
    duplicatePlaceId: duplicate.placeId,
    policy: "exact-sanitized-content-sha256",
  });
}

function sanitizePhotoForR2(imageBase64: string | null, storageKey: string, mimeType: PhotoRecord["mimeType"]): SanitizedPhoto {
  if (!imageBase64) {
    throw new HttpError(400, "PHOTO_IMAGE_REQUIRED", "R2 저장에는 정화할 이미지 파일이 필요합니다.");
  }

  const original = decodeImageBase64(imageBase64);
  if (original.byteLength < 4 || original.byteLength > PHOTO_MAX_BYTES) {
    throw new HttpError(400, "PHOTO_SIZE_LIMIT", "사진 크기 제한을 초과했습니다.");
  }

  if (mimeType === "image/jpeg") {
    assertJpegBytes(original);
    const sanitized = stripJpegMetadata(original);
    return {
      bytes: sanitized.bytes,
      mimeType,
      originalBytes: original.byteLength,
      sanitizedBytes: sanitized.bytes.byteLength,
      metadataRemoved: sanitized.metadataRemoved,
      pixelsReencoded: false,
      processing: "worker-metadata-stripped",
    };
  }

  if (mimeType === "image/webp") {
    assertWebpBytes(original);
    const sanitized = stripWebpMetadata(original);
    return {
      bytes: sanitized.bytes,
      mimeType,
      originalBytes: original.byteLength,
      sanitizedBytes: sanitized.bytes.byteLength,
      metadataRemoved: sanitized.metadataRemoved,
      pixelsReencoded: false,
      processing: "worker-metadata-stripped",
    };
  }

  throw new HttpError(400, "PHOTO_MIME_TYPE", `${storageKey} 사진 형식을 처리할 수 없습니다.`);
}

async function reencodePhotoWithImagesBinding(
  photo: SanitizedPhoto,
  images: ImagesBinding,
  width: number,
  height: number,
): Promise<SanitizedPhoto> {
  const output = await images
    .input(arrayBufferForBytes(photo.bytes))
    .transform({
      width: Math.min(width, 1280),
      height: Math.min(height, 1280),
      fit: "scale-down",
    })
    .output({
      format: photo.mimeType === "image/jpeg" ? "image/jpeg" : "image/webp",
      quality: 82,
      anim: false,
    });
  const response = await output.response();
  if (!response.ok) {
    throw new HttpError(502, "PHOTO_REENCODE_FAILED", "서버 이미지 재인코딩에 실패했습니다.");
  }

  const reencoded = new Uint8Array(await response.arrayBuffer());
  if (reencoded.byteLength < 4 || reencoded.byteLength > PHOTO_MAX_BYTES) {
    throw new HttpError(400, "PHOTO_REENCODE_SIZE_LIMIT", "서버 재인코딩 사진 크기 제한을 초과했습니다.");
  }

  if (photo.mimeType === "image/jpeg") {
    assertJpegBytes(reencoded);
  } else {
    assertWebpBytes(reencoded);
  }

  return {
    bytes: reencoded,
    mimeType: photo.mimeType,
    originalBytes: photo.originalBytes,
    sanitizedBytes: reencoded.byteLength,
    metadataRemoved: photo.metadataRemoved,
    pixelsReencoded: true,
    processing: "cloudflare-images-reencoded",
  };
}

function decodeImageBase64(value: string): Uint8Array {
  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const normalized = base64.replace(/\s/g, "");
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(normalized)) {
    throw new HttpError(400, "PHOTO_BASE64_INVALID", "사진 파일 인코딩이 올바르지 않습니다.");
  }

  let binary = "";
  try {
    binary = atob(normalized);
  } catch {
    throw new HttpError(400, "PHOTO_BASE64_INVALID", "사진 파일 인코딩이 올바르지 않습니다.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function assertJpegBytes(bytes: Uint8Array): void {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new HttpError(400, "PHOTO_MIME_SNIFF_FAILED", "JPEG 파일 헤더가 올바르지 않습니다.");
  }
}

function assertWebpBytes(bytes: Uint8Array): void {
  if (bytesToAscii(bytes, 0, 4) !== "RIFF" || bytesToAscii(bytes, 8, 12) !== "WEBP") {
    throw new HttpError(400, "PHOTO_MIME_SNIFF_FAILED", "WebP 파일 헤더가 올바르지 않습니다.");
  }
}

function stripJpegMetadata(bytes: Uint8Array): { bytes: Uint8Array; metadataRemoved: boolean } {
  const chunks: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  let metadataRemoved = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      chunks.push(bytes.slice(offset));
      break;
    }

    let markerOffset = offset;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) {
      markerOffset += 1;
    }

    if (markerOffset >= bytes.length) {
      break;
    }

    const marker = bytes[markerOffset];
    const segmentStart = offset;
    const markerEnd = markerOffset + 1;
    offset = markerEnd;

    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.slice(segmentStart, markerEnd));
      continue;
    }

    if (markerEnd + 2 > bytes.length) {
      throw new HttpError(400, "PHOTO_JPEG_INVALID", "JPEG segment가 올바르지 않습니다.");
    }

    const segmentLength = readUint16BE(bytes, markerEnd);
    if (segmentLength < 2) {
      throw new HttpError(400, "PHOTO_JPEG_INVALID", "JPEG segment 길이가 올바르지 않습니다.");
    }

    const segmentEnd = markerEnd + segmentLength;
    if (segmentEnd > bytes.length) {
      throw new HttpError(400, "PHOTO_JPEG_INVALID", "JPEG segment가 파일 범위를 벗어났습니다.");
    }

    if (marker === 0xda) {
      chunks.push(bytes.slice(segmentStart));
      break;
    }

    if (shouldStripJpegMarker(marker)) {
      metadataRemoved = true;
      offset = segmentEnd;
      continue;
    }

    chunks.push(bytes.slice(segmentStart, segmentEnd));
    offset = segmentEnd;
  }

  return { bytes: concatBytes(chunks), metadataRemoved };
}

function shouldStripJpegMarker(marker: number): boolean {
  if (marker === 0xfe) {
    return true;
  }

  if (marker >= 0xe1 && marker <= 0xed) {
    return true;
  }

  return marker === 0xef;
}

function stripWebpMetadata(bytes: Uint8Array): { bytes: Uint8Array; metadataRemoved: boolean } {
  const chunks: Uint8Array[] = [];
  let offset = 12;
  let metadataRemoved = false;

  while (offset + 8 <= bytes.length) {
    const chunkType = bytesToAscii(bytes, offset, offset + 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    const paddedEnd = dataEnd + (chunkSize % 2);
    if (dataEnd > bytes.length || paddedEnd > bytes.length) {
      throw new HttpError(400, "PHOTO_WEBP_INVALID", "WebP chunk가 파일 범위를 벗어났습니다.");
    }

    if (chunkType === "EXIF" || chunkType === "XMP ") {
      metadataRemoved = true;
    } else {
      chunks.push(bytes.slice(offset, paddedEnd));
    }

    offset = paddedEnd;
  }

  if (offset !== bytes.length) {
    throw new HttpError(400, "PHOTO_WEBP_INVALID", "WebP 파일 끝이 올바르지 않습니다.");
  }

  const payload = concatBytes(chunks);
  const sanitized = new Uint8Array(12 + payload.byteLength);
  sanitized.set(asciiBytes("RIFF"), 0);
  writeUint32LE(sanitized, 4, sanitized.byteLength - 8);
  sanitized.set(asciiBytes("WEBP"), 8);
  sanitized.set(payload, 12);

  return { bytes: sanitized, metadataRemoved };
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}

function bytesToAscii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }

  return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function arrayBufferForBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function clickPhoto(photoId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const photo = await getD1VisiblePhoto(env.DB, photoId);
    if (!photo) {
      return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
    const created = await createD1UniqueInteraction(env.DB, anonymousUserId, "photo", photoId);
    const clickCount = await countD1Interactions(env.DB, "photo", photoId);

    return json({ photoId, clickCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once", storage: "d1" });
  }

  const photo = photos.find((candidate) => candidate.id === photoId);
  if (!photo || photo.status !== "ready" || photo.deletedAt) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  const state = likeStateFor(session.id);
  const created = registerUniquePhotoClick(state, photoId);
  if (created) {
    photo.clickCount += 1;
  }

  return json({ photoId, clickCount: photo.clickCount, created }, { duplicatePolicy: "same-anonymous-user-counts-once" });
}

async function servePhotoFile(photoId: string, env: Env): Promise<Response> {
  if (!env.PHOTOS) {
    return errorResponse(404, "PHOTO_FILE_NOT_AVAILABLE", "사진 파일을 찾을 수 없습니다.");
  }

  const photo = env.DB
    ? await getD1PublicRecentPhoto(env.DB, photoId)
    : photos.find((candidate) => candidate.id === photoId && candidate.status === "ready" && !candidate.deletedAt && isActiveRecentContent(candidate.createdAt));
  if (!photo) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  const object = await env.PHOTOS.get(photo.storageKey);
  if (!object) {
    return errorResponse(404, "PHOTO_FILE_NOT_FOUND", "사진 파일을 찾을 수 없습니다.");
  }

  return new Response(object.body, {
    headers: {
      ...corsHeaders(),
      "content-type": object.httpMetadata?.contentType ?? photo.mimeType,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function deletePhoto(photoId: string, session: AnonymousSession, env: Env): Promise<Response> {
  if (env.DB) {
    const photo = await getD1VisiblePhoto(env.DB, photoId);
    if (!photo) {
      return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
    }

    const anonymousUserId = await ensureD1AnonymousUser(env.DB, session);
    if (photo.anonymousUserId !== anonymousUserId) {
      return errorResponse(403, "PHOTO_DELETE_FORBIDDEN", "내가 올린 사진만 삭제할 수 있습니다.");
    }

    await env.DB.prepare("UPDATE photos SET deleted_at = ? WHERE id = ?").bind(new Date().toISOString(), photoId).run();

    return json({ photoId, deleted: true }, { storage: "d1" });
  }

  const photo = photos.find((candidate) => candidate.id === photoId);
  if (!photo || photo.deletedAt) {
    return errorResponse(404, "PHOTO_NOT_FOUND", "사진을 찾을 수 없습니다.");
  }

  if (photo.anonymousUserId !== session.id) {
    return errorResponse(403, "PHOTO_DELETE_FORBIDDEN", "내가 올린 사진만 삭제할 수 있습니다.");
  }

  photo.deletedAt = new Date().toISOString();

  return json({ photoId, deleted: true });
}

async function createReport(request: Request, session: AnonymousSession, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readJson(request);
  const targetType = enumField(body, "targetType", ["place", "comment", "photo"] as const);
  const targetId = stringField(body, "targetId", 100);
  const reason = enumField(body, "reason", ["false_content", "spam", "privacy_face", "privacy_plate", "sensitive_info", "other"] as const);
  const note = optionalStringField(body, "note", 200);
  const anonymousUserId = env.DB ? await ensureD1AnonymousUser(env.DB, session) : session.id;
  if (env.DB) {
    await assertD1AnonymousUserCanWrite(env.DB, anonymousUserId);
  }

  if (env.DB) {
    const duplicate = await env.DB
      .prepare(
        `SELECT
          id,
          target_type AS targetType,
          target_id AS targetId,
          reason,
          anonymous_user_id AS anonymousUserId,
          note,
          status,
          created_at AS createdAt
        FROM reports
        WHERE anonymous_user_id = ? AND target_type = ? AND target_id = ? AND reason = ? AND status = 'open'
        LIMIT 1`,
      )
      .bind(anonymousUserId, targetType, targetId, reason)
      .first<D1ReportRow>();
    if (duplicate) {
      return json(duplicate, { duplicatePolicy: "same-anonymous-user-open-report-counts-once", storage: "d1" }, 200);
    }
  }

  const place = await resolveReportTarget(targetType, targetId, env);

  const report: ReportRecord = {
    id: `report_${crypto.randomUUID()}`,
    targetType,
    targetId,
    reason,
    anonymousUserId,
    note: note ?? null,
    status: "open",
    createdAt: new Date().toISOString(),
  };

  if (env.DB) {
    await env.DB
      .prepare(
        `INSERT INTO reports
          (id, target_type, target_id, anonymous_user_id, reason, note, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .bind(report.id, report.targetType, report.targetId, report.anonymousUserId, report.reason, report.note, report.createdAt)
      .run();
    const priority = d1ModerationPriority(reason);
    await env.DB
      .prepare("INSERT INTO moderation_reports (id, report_id, priority, decision, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)")
      .bind(`mod_${crypto.randomUUID()}`, report.id, priority, report.createdAt, report.createdAt)
      .run();
    await incrementD1ReportCounter(env.DB, targetType, targetId);
    await applyD1ProtectionForReport(env.DB, report);
    if (place) {
      await recordD1PlaceEvent(env.DB, place, report.anonymousUserId, "report");
    }
    ctx.waitUntil(
      place
        ? broadcastPlaceActivity(env, "report.created", place, {
            id: report.id,
            targetType,
            targetId,
            placeId: place.id,
            regionId: place.regionId,
            areaId: place.areaId,
          })
        : broadcastToRooms(env, "report.created", "global", "global", { id: report.id, targetType, targetId }),
    );
    const alertChannel = enqueueModerationAlert(ctx, env, report, priority);

    return json(report, { moderationPolicy: "open-reports-enter-d1-moderation-queue", storage: "d1", alertChannel }, 201);
  }

  reports.unshift(report);
  ctx.waitUntil(
    place
      ? broadcastPlaceActivity(env, "report.created", place, {
          id: report.id,
          targetType,
          targetId,
          placeId: place.id,
          regionId: place.regionId,
          areaId: place.areaId,
        })
      : broadcastToRooms(env, "report.created", "global", "global", { id: report.id, targetType, targetId }),
  );
  const alertChannel = enqueueModerationAlert(ctx, env, report, d1ModerationPriority(reason));

  return json(report, { moderationPolicy: "open-reports-require-admin-token", alertChannel }, 201);
}

async function listModerationReports(url: URL, env: Env): Promise<Response> {
  const status = url.searchParams.get("status");
  const limit = clampLimit(url.searchParams.get("limit"));
  if (env.DB) {
    const values: D1Value[] = [];
    const where = [];
    if (status) {
      where.push("r.status = ?");
      values.push(status);
    }
    values.push(limit);
    const { results = [] } = await env.DB
      .prepare(
        `SELECT
          r.id,
          r.target_type AS targetType,
          r.target_id AS targetId,
          r.reason,
          r.anonymous_user_id AS anonymousUserId,
          r.note,
          r.status,
          r.created_at AS createdAt
        FROM reports r
        LEFT JOIN moderation_reports mr ON mr.report_id = r.id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY
          CASE mr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
          r.created_at DESC
        LIMIT ?`,
      )
      .bind(...values)
      .all<D1ReportRow>();

    return json(results, { limit, authz: "moderator-role", storage: "d1" });
  }

  const data = reports.filter((report) => !status || report.status === status).slice(0, limit);

  return json(data, { limit, authz: "moderator-role" });
}

async function moderateReport(reportId: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const status = enumField(body, "status", ["accepted", "rejected"] as const);
  const reason = optionalStringField(body, "reason", 500) ?? null;

  if (env.DB) {
    const report = await getD1Report(env.DB, reportId);
    if (!report) {
      return errorResponse(404, "REPORT_NOT_FOUND", "신고를 찾을 수 없습니다.");
    }

    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE reports SET status = ?, resolved_at = ? WHERE id = ?").bind(status, now, reportId).run();
    await env.DB
      .prepare("UPDATE moderation_reports SET decision = ?, decision_note = ?, updated_at = ? WHERE report_id = ?")
      .bind(status === "accepted" ? "accept" : "reject", reason, now, reportId)
      .run();
    await env.DB
      .prepare("INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(
        `admin_${crypto.randomUUID()}`,
        adminSubject(request),
        `report_${status}`,
        report.targetType,
        report.targetId,
        reason,
        now,
      )
      .run();

    const updated: ReportRecord = { ...report, status };
    if (status === "accepted") {
      await applyD1ProtectionForReport(env.DB, updated);
    }

    return json(updated, { auditPolicy: "admin_actions", storage: "d1" });
  }

  const report = reports.find((candidate) => candidate.id === reportId);
  if (!report) {
    return errorResponse(404, "REPORT_NOT_FOUND", "신고를 찾을 수 없습니다.");
  }

  report.status = status;

  return json(report, { auditPolicy: "admin_actions table records this in D1 migration" });
}

async function moderateContent(request: Request, env: Env, action: AdminModerationAction): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "운영 조치에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const targetType = enumField(body, "targetType", ["place", "comment", "photo"] as const);
  const targetId = stringField(body, "targetId", 100);
  const reason = action === "restore" ? optionalStringField(body, "reason", 500) ?? null : stringField(body, "reason", 500);
  const target = await getD1ModerationTarget(env.DB, targetType, targetId);
  if (!target.exists) {
    return errorResponse(404, "MODERATION_TARGET_NOT_FOUND", "운영 조치 대상을 찾을 수 없습니다.");
  }

  let r2Deleted = false;
  if (action === "delete" && targetType === "photo" && target.storageKey && env.PHOTOS) {
    await env.PHOTOS.delete(target.storageKey);
    r2Deleted = true;
  }

  await applyD1ModerationAction(env.DB, targetType, targetId, action, reason);
  await recordAdminAction(env.DB, request, action, targetType, targetId, reason);
  const cacheInvalidation = await invalidateModerationCache(env, targetType, targetId, target);

  return json(
    {
      targetType,
      targetId,
      action,
      r2Deleted,
    },
    {
      auditPolicy: "admin_actions",
      storage: "d1",
      r2Policy: targetType === "photo" && action === "delete" ? "delete-r2-object-before-public-removal-complete" : "not-applicable",
      cacheInvalidation,
    },
  );
}

async function bulkModerateContent(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "운영 조치에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const action = enumField(body, "action", ["hide", "restore"] as const);
  const reason = action === "restore" ? optionalStringField(body, "reason", 500) ?? null : stringField(body, "reason", 500);
  const targets = bulkModerationTargetsField(body, 20);
  const results: AdminBulkModerationResult[] = [];
  const cacheKeys = new Set<string>();
  const deletedCacheKeys = new Set<string>();

  for (const item of targets) {
    const target = await getD1ModerationTarget(env.DB, item.targetType, item.targetId);
    if (!target.exists) {
      results.push({ ...item, status: "not_found" });
      continue;
    }

    await applyD1ModerationAction(env.DB, item.targetType, item.targetId, action, reason);
    await recordAdminAction(env.DB, request, `bulk_${action}`, item.targetType, item.targetId, reason);
    const cacheInvalidation = await invalidateModerationCache(env, item.targetType, item.targetId, target);
    for (const key of cacheInvalidation.keys) {
      cacheKeys.add(key);
    }
    for (const key of cacheInvalidation.deletedKeys) {
      deletedCacheKeys.add(key);
    }
    results.push({ ...item, status: "ok" });
  }

  const succeeded = results.filter((result) => result.status === "ok").length;

  return json(
    {
      action,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    },
    {
      auditPolicy: "admin_actions",
      storage: "d1",
      bulkLimit: 20,
      cacheInvalidation: {
        binding: env.CACHE ? "CACHE" : "none",
        keys: [...cacheKeys],
        deletedKeys: [...deletedCacheKeys],
      },
    },
  );
}

async function updatePlaceCoordinateStatus(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "장소 좌표 상태 변경에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const placeId = stringField(body, "placeId", 100);
  const coordinateStatus = enumField(body, "coordinateStatus", ["verified", "TODO_COORDINATE_VERIFY", "rejected"] as const);
  const source = stringField(body, "source", 160);
  const reason = stringField(body, "reason", 300);
  const target = await getD1ModerationTarget(env.DB, "place", placeId);
  if (!target.exists) {
    return errorResponse(404, "PLACE_NOT_FOUND", "좌표 상태를 변경할 장소를 찾을 수 없습니다.");
  }

  const latitude = coordinateStatus === "verified" ? coordinateField(body, "latitude", -90, 90) : null;
  const longitude = coordinateStatus === "verified" ? coordinateField(body, "longitude", -180, 180) : null;
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE places
       SET coordinate_status = ?,
           latitude = ?,
           longitude = ?,
           is_active = CASE WHEN ? = 'rejected' THEN 0 ELSE is_active END,
           launch_stage = CASE WHEN ? = 'verified' AND launch_stage = 'seed' THEN 'beta' ELSE launch_stage END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(coordinateStatus, latitude, longitude, coordinateStatus, coordinateStatus, now, placeId)
    .run();

  await recordAdminAction(env.DB, request, "place_coordinate_status", "place", placeId, `status=${coordinateStatus}; source=${source}; reason=${reason}`);
  const cacheInvalidation = await invalidateModerationCache(env, "place", placeId, target);

  return json(
    {
      placeId,
      coordinateStatus,
      latitude,
      longitude,
    },
    {
      authz: "operator-role",
      auditPolicy: "admin_actions",
      storage: "d1",
      cacheInvalidation,
    },
  );
}

async function restrictUser(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "사용자 제한에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const anonymousUserId = anonymousUserIdField(body, "anonymousUserId");
  const reason = stringField(body, "reason", 200);
  const blockedUntil = optionalFutureIsoDateField(body, "blockedUntil");
  const existing = await getD1AnonymousUser(env.DB, anonymousUserId);
  if (!existing) {
    return errorResponse(404, "ANONYMOUS_USER_NOT_FOUND", "제한할 사용자를 찾을 수 없습니다.");
  }

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO blocked_users (id, anonymous_user_id, reason, blocked_until, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(anonymous_user_id) DO UPDATE SET
         reason = excluded.reason,
         blocked_until = excluded.blocked_until,
         created_at = excluded.created_at`,
    )
    .bind(`block_${crypto.randomUUID()}`, anonymousUserId, reason, blockedUntil, now)
    .run();
  await recordAdminAction(env.DB, request, "user_restrict", "anonymous_user", anonymousUserId, reason);

  return json(
    {
      anonymousUserId,
      restricted: true,
      blockedUntil,
    },
    {
      authz: "admin-role",
      auditPolicy: "admin_actions",
      storage: "d1",
    },
  );
}

async function unrestrictUser(request: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    throw new HttpError(503, "D1_NOT_CONFIGURED", "사용자 제한 해제에는 D1 바인딩이 필요합니다.");
  }

  const body = await readJson(request);
  const anonymousUserId = anonymousUserIdField(body, "anonymousUserId");
  const reason = optionalStringField(body, "reason", 500) ?? null;
  const existing = await getD1AnonymousUser(env.DB, anonymousUserId);
  if (!existing) {
    return errorResponse(404, "ANONYMOUS_USER_NOT_FOUND", "제한 해제할 사용자를 찾을 수 없습니다.");
  }

  await env.DB.prepare("DELETE FROM blocked_users WHERE anonymous_user_id = ?").bind(anonymousUserId).run();
  await recordAdminAction(env.DB, request, "user_unrestrict", "anonymous_user", anonymousUserId, reason);

  return json(
    {
      anonymousUserId,
      restricted: false,
    },
    {
      authz: "admin-role",
      auditPolicy: "admin_actions",
      storage: "d1",
    },
  );
}

async function invalidateModerationCache(
  env: Env,
  targetType: ReportRecord["targetType"],
  targetId: string,
  target: D1ModerationTarget,
): Promise<CacheInvalidationResult> {
  const keys = moderationCacheKeys(targetType, targetId, target);
  if (!env.CACHE) {
    return { binding: "none", keys, deletedKeys: [] };
  }

  for (const key of keys) {
    await env.CACHE.delete(key);
  }
  await env.CACHE.put(RANKING_CACHE_VERSION_KEY, String(Date.now()));

  return { binding: "CACHE", keys, deletedKeys: keys };
}

function moderationCacheKeys(targetType: ReportRecord["targetType"], targetId: string, target: D1ModerationTarget): string[] {
  const keys = new Set<string>(["rankings:nationwide", "rankings:map-bounds"]);

  if (target.regionId) {
    keys.add(`rankings:region:${target.regionId}`);
    keys.add(`rankings:area:${target.regionId}`);
    keys.add(`rankings:category:${target.regionId}`);
  }

  if (target.placeId) {
    keys.add(`places:${target.placeId}`);
    keys.add(`place-live:${target.placeId}`);
    keys.add(`rankings:place:${target.placeId}`);
  }

  if (targetType === "comment" && target.placeId) {
    keys.add(`comments:${target.placeId}`);
  }

  if (targetType === "photo" && target.placeId) {
    keys.add(`photos:${target.placeId}`);
  }

  if (targetType === "place") {
    keys.add(`places:${targetId}`);
  }

  return [...keys];
}

function routeRealtime(request: Request, env: Env, _ctx: ExecutionContext, url: URL, path: string): Promise<Response> | Response | null {
  if (!path.startsWith("/api/realtime")) {
    return null;
  }

  const pathMatch = path.match(/^\/api\/realtime\/(place|region|global)(?:\/([^/]+))?$/);
  const scope = pathMatch
    ? (pathMatch[1] as "place" | "region" | "global")
    : enumFromSearch(url, "scope", ["place", "region", "global"] as const, "global");
  const roomId = pathMatch?.[2] ? decodeURIComponent(pathMatch[2]) : url.searchParams.get("roomId") ?? (scope === "global" ? "global" : "");
  if (!roomId) {
    return errorResponse(400, "ROOM_ID_REQUIRED", "실시간 roomId가 필요합니다.");
  }

  const namespace = scope === "place" ? env.PLACE_ROOM : scope === "region" ? env.REGION_ROOM : env.GLOBAL_ROOM;
  if (namespace) {
    const stub = namespace.get(namespace.idFromName(roomId));
    return stub.fetch(requestWithRoomId(request, roomId));
  }

  return json(
    {
      mode: "polling",
      scope,
      roomId,
      events: getRoomEvents(roomKey(scope, roomId)),
    },
    {
      fallback: "Durable Object binding이 없으면 최근 이벤트 polling으로 대체합니다.",
    },
  );
}

function requestWithRoomId(request: Request, roomId: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("roomId", roomId);
  return new Request(url, request);
}

function broadcastPlaceActivity(env: Env, type: RoomBroadcast["type"], place: PlaceRecord, payload: JsonObject): Promise<void> {
  return Promise.all([
    broadcastToRooms(env, type, "place", place.id, payload),
    broadcastToRooms(env, type, "region", place.regionId, payload),
    broadcastToRooms(env, type, "global", "global", payload),
  ]).then(() => undefined);
}

async function broadcastToRooms(
  env: Env,
  type: RoomBroadcast["type"],
  scope: RoomBroadcast["scope"],
  roomId: string,
  payload: JsonObject,
): Promise<void> {
  const event: RoomBroadcast = {
    type,
    scope,
    roomId,
    payload,
    createdAt: new Date().toISOString(),
  };
  const key = roomKey(scope, roomId);
  const events = [event, ...getRoomEvents(key)].slice(0, 50);
  roomEvents.set(key, events);

  const namespace = scope === "place" ? env.PLACE_ROOM : scope === "region" ? env.REGION_ROOM : env.GLOBAL_ROOM;
  if (!namespace) {
    return;
  }

  const stub = namespace.get(namespace.idFromName(roomId));
  await stub.fetch(
    new Request(`https://silsigan.internal/api/realtime/broadcast?roomId=${encodeURIComponent(roomId)}`, {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "content-type": "application/json" },
    }),
  );
}

async function enforceRateLimit(scope: string, request: Request, anonymousUserId: string, limit: number, windowMs: number): Promise<void> {
  const key = `${scope}:${anonymousUserId}:${clientIpHint(request)}`;
  const current = rateBuckets.get(key);
  const { state, result } = applySlidingWindowRateLimit(current, Date.now(), limit, windowMs);
  rateBuckets.set(key, state);

  if (!result.allowed) {
    throw new HttpError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

function getAnonymousSession(request: Request): AnonymousSession {
  const headerId = request.headers.get("x-silsigan-anon-id")?.trim();
  const cookieId = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("silsigan_anon_id="))
    ?.split("=")[1];
  const candidate = headerId || cookieId;

  if (candidate && /^[a-zA-Z0-9_-]{12,80}$/.test(candidate)) {
    return { id: candidate, isNew: false };
  }

  return { id: `anon_${crypto.randomUUID()}`, isNew: true };
}

function sessionHeadersFor(session: AnonymousSession): Headers {
  const headers = new Headers();
  headers.set("x-silsigan-anon-id", session.id);
  if (session.isNew) {
    headers.append("set-cookie", `silsigan_anon_id=${session.id}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`);
  }

  return headers;
}

function likeStateFor(anonymousUserId: string): LikePolicyState {
  const existing = likeStateByAnon.get(anonymousUserId);
  if (existing) {
    return existing;
  }

  const state = { likedPlaceIds: new Set<string>(), likedCommentIds: new Set<string>(), clickedPhotoIds: new Set<string>() };
  likeStateByAnon.set(anonymousUserId, state);
  return state;
}

async function requireAdmin(request: Request, env: Env, minimumRole: AdminRole): Promise<AdminRole> {
  const provided = request.headers.get("x-silsigan-admin-token") ?? "";
  const credentials = adminCredentials(env);

  let matchedRole: AdminRole | null = null;
  for (const credential of credentials) {
    if (await timingSafeEqualString(provided, credential.token)) {
      matchedRole = credential.role;
      break;
    }
  }

  if (!matchedRole) {
    throw new HttpError(403, "FORBIDDEN", "운영 API 권한이 없습니다.");
  }

  if (adminRoleRank[matchedRole] < adminRoleRank[minimumRole]) {
    throw new HttpError(403, "INSUFFICIENT_ADMIN_ROLE", `${minimumRole} 권한이 필요한 작업입니다.`);
  }

  return matchedRole;
}

function adminCredentials(env: Env): AdminCredential[] {
  const credentials: AdminCredential[] = [];
  if (env.ADMIN_TOKENS) {
    credentials.push(...parseAdminTokens(env.ADMIN_TOKENS));
  }

  if (env.ADMIN_TOKEN) {
    credentials.push({ role: "admin", token: env.ADMIN_TOKEN, source: "ADMIN_TOKEN" });
  }

  if (credentials.length === 0) {
    throw new HttpError(503, "ADMIN_TOKEN_NOT_CONFIGURED", "운영 API 토큰이 설정되지 않았습니다.");
  }

  return credentials;
}

function parseAdminTokens(raw: string): AdminCredential[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(503, "ADMIN_TOKENS_INVALID", "운영 role 토큰 설정이 올바른 JSON이 아닙니다.");
  }

  if (!isRecord(parsed)) {
    throw new HttpError(503, "ADMIN_TOKENS_INVALID", "운영 role 토큰 설정은 JSON 객체여야 합니다.");
  }

  const credentials: AdminCredential[] = [];
  for (const role of adminRoles) {
    const value = parsed[role];
    if (typeof value === "string" && value.length > 0) {
      credentials.push({ role, token: value, source: "ADMIN_TOKENS" });
      continue;
    }

    if (Array.isArray(value) && value.every((item): item is string => typeof item === "string" && item.length > 0)) {
      credentials.push(...value.map((token) => ({ role, token, source: "ADMIN_TOKENS" as const })));
      continue;
    }

    if (value !== undefined) {
      throw new HttpError(503, "ADMIN_TOKENS_INVALID", `${role} 운영 토큰 설정이 올바르지 않습니다.`);
    }
  }

  if (credentials.length === 0) {
    throw new HttpError(503, "ADMIN_TOKENS_INVALID", "운영 role 토큰이 하나 이상 필요합니다.");
  }

  return credentials;
}

async function timingSafeEqualString(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([sha256Bytes(provided), sha256Bytes(expected)]);
  let difference = providedDigest.length ^ expectedDigest.length;
  const length = Math.max(providedDigest.length, expectedDigest.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (providedDigest[index] ?? 0) ^ (expectedDigest[index] ?? 0);
  }

  return difference === 0;
}

function findPlaceRecord(placeId: string): PlaceRecord {
  const place = seedPlaces.find((candidate) => candidate.id === placeId);
  if (!place) {
    throw new HttpError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다.");
  }

  return place;
}

async function resolvePlaceRecord(placeId: string, env: Env): Promise<PlaceRecord> {
  if (!env.DB) {
    return findPlaceRecord(placeId);
  }

  const row = await env.DB
    .prepare(
      `${d1PlaceSelectSql()}
       WHERE p.id = ? AND p.is_active = 1 AND p.coordinate_status = 'verified' AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
       LIMIT 1`,
    )
    .bind(placeId)
    .first<D1PlaceRow>();
  if (!row) {
    throw new HttpError(404, "PLACE_NOT_FOUND", "장소를 찾을 수 없습니다.");
  }

  return d1PlaceRowToRecord(row);
}

async function resolveReportTarget(targetType: ReportRecord["targetType"], targetId: string, env: Env): Promise<PlaceRecord | null> {
  if (targetType === "place") {
    return resolvePlaceRecord(targetId, env);
  }

  if (env.DB) {
    if (targetType === "comment") {
      const comment = await getD1VisibleComment(env.DB, targetId);
      if (comment) {
        return resolvePlaceRecord(comment.placeId, env);
      }
    }

    if (targetType === "photo") {
      const photo = await getD1VisiblePhoto(env.DB, targetId);
      if (photo) {
        return resolvePlaceRecord(photo.placeId, env);
      }
    }

    throw new HttpError(404, "REPORT_TARGET_NOT_FOUND", "신고 대상을 찾을 수 없습니다.");
  }

  if (targetType === "comment" && comments.some((comment) => comment.id === targetId)) {
    const comment = comments.find((candidate) => candidate.id === targetId);
    return comment ? findPlaceRecord(comment.placeId) : null;
  }

  if (targetType === "photo" && photos.some((photo) => photo.id === targetId && !photo.deletedAt)) {
    const photo = photos.find((candidate) => candidate.id === targetId && !candidate.deletedAt);
    return photo ? findPlaceRecord(photo.placeId) : null;
  }

  throw new HttpError(404, "REPORT_TARGET_NOT_FOUND", "신고 대상을 찾을 수 없습니다.");
}

async function ensureD1AnonymousUser(db: D1Database, session: AnonymousSession): Promise<string> {
  const sessionHash = await sha256Hex(`silsigan-anon:${session.id}`);
  const anonymousUserId = `anon_${sessionHash.slice(0, 48)}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO anonymous_users (id, session_hash, trust_score, created_at, last_seen_at)
       VALUES (?, ?, 50, ?, ?)
       ON CONFLICT(session_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .bind(anonymousUserId, sessionHash, now, now)
    .run();

  return anonymousUserId;
}

async function getD1AnonymousUser(db: D1Database, anonymousUserId: string): Promise<{ id: string } | null> {
  return db.prepare("SELECT id FROM anonymous_users WHERE id = ? LIMIT 1").bind(anonymousUserId).first<{ id: string }>();
}

async function assertD1AnonymousUserCanWrite(db: D1Database, anonymousUserId: string): Promise<void> {
  const block = await db
    .prepare(
      `SELECT reason, blocked_until AS blockedUntil
       FROM blocked_users
       WHERE anonymous_user_id = ?
         AND (blocked_until IS NULL OR blocked_until > ?)
       LIMIT 1`,
    )
    .bind(anonymousUserId, new Date().toISOString())
    .first<D1BlockedUserRow>();

  if (!block) {
    return;
  }

  throw new HttpError(403, "USER_RESTRICTED", "운영 정책 위반으로 일시 제한된 사용자입니다.", {
    blockedUntil: block.blockedUntil,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256Bytes(value);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function getD1VisibleComment(db: D1Database, commentId: string): Promise<D1CommentRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        body,
        like_count AS likeCount,
        hidden_at AS hiddenAt,
        created_at AS createdAt
      FROM comments
      WHERE id = ? AND status = 'visible' AND hidden_at IS NULL AND deleted_at IS NULL
      LIMIT 1`,
    )
    .bind(commentId)
    .first<D1CommentRow>();
}

async function getD1VisiblePhoto(db: D1Database, photoId: string): Promise<D1PhotoRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        r2_key AS storageKey,
        mime_type AS mimeType,
        byte_size AS byteSize,
        width,
        height,
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.target_type = 'photo' AND l.target_id = photos.id), 0) AS clickCount,
        status,
        deleted_at AS deletedAt,
        created_at AS createdAt
      FROM photos
      WHERE id = ? AND status = 'ready' AND deleted_at IS NULL AND hidden_at IS NULL
      LIMIT 1`,
    )
    .bind(photoId)
    .first<D1PhotoRow>();
}

async function getD1PublicRecentPhoto(db: D1Database, photoId: string): Promise<D1PhotoRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        place_id AS placeId,
        anonymous_user_id AS anonymousUserId,
        r2_key AS storageKey,
        mime_type AS mimeType,
        byte_size AS byteSize,
        width,
        height,
        COALESCE((SELECT COUNT(*) FROM likes l WHERE l.target_type = 'photo' AND l.target_id = photos.id), 0) AS clickCount,
        status,
        deleted_at AS deletedAt,
        created_at AS createdAt
      FROM photos
      WHERE id = ?
        AND status = 'ready'
        AND deleted_at IS NULL
        AND hidden_at IS NULL
        AND created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}
      LIMIT 1`,
    )
    .bind(photoId)
    .first<D1PhotoRow>();
}

async function getD1Report(db: D1Database, reportId: string): Promise<D1ReportRow | null> {
  return db
    .prepare(
      `SELECT
        id,
        target_type AS targetType,
        target_id AS targetId,
        reason,
        anonymous_user_id AS anonymousUserId,
        note,
        status,
        created_at AS createdAt
      FROM reports
      WHERE id = ?
      LIMIT 1`,
    )
    .bind(reportId)
    .first<D1ReportRow>();
}

async function getD1ModerationTarget(
  db: D1Database,
  targetType: ReportRecord["targetType"],
  targetId: string,
): Promise<D1ModerationTarget> {
  if (targetType === "place") {
    const row = await db.prepare("SELECT id, region_id AS regionId FROM places WHERE id = ? LIMIT 1").bind(targetId).first<{ id: string; regionId: string }>();
    return { exists: Boolean(row), storageKey: null, placeId: row?.id ?? null, regionId: row?.regionId ?? null };
  }

  if (targetType === "comment") {
    const row = await db
      .prepare(
        `SELECT c.id, c.place_id AS placeId, p.region_id AS regionId
         FROM comments c
         LEFT JOIN places p ON p.id = c.place_id
         WHERE c.id = ?
         LIMIT 1`,
      )
      .bind(targetId)
      .first<{ id: string; placeId: string; regionId: string | null }>();
    return { exists: Boolean(row), storageKey: null, placeId: row?.placeId ?? null, regionId: row?.regionId ?? null };
  }

  const row = await db
    .prepare(
      `SELECT ph.id, ph.place_id AS placeId, p.region_id AS regionId, ph.r2_key AS storageKey
       FROM photos ph
       LEFT JOIN places p ON p.id = ph.place_id
       WHERE ph.id = ?
       LIMIT 1`,
    )
    .bind(targetId)
    .first<{ id: string; placeId: string; regionId: string | null; storageKey: string }>();
  return { exists: Boolean(row), storageKey: row?.storageKey ?? null, placeId: row?.placeId ?? null, regionId: row?.regionId ?? null };
}

async function applyD1ModerationAction(
  db: D1Database,
  targetType: ReportRecord["targetType"],
  targetId: string,
  action: AdminModerationAction,
  reason: string | null,
): Promise<void> {
  const now = new Date().toISOString();

  if (targetType === "place") {
    const isActive = action === "restore" ? 1 : 0;
    const launchStage = action === "delete" ? "paused" : action === "restore" ? "active" : "paused";
    await db.prepare("UPDATE places SET is_active = ?, launch_stage = ?, updated_at = ? WHERE id = ?").bind(isActive, launchStage, now, targetId).run();
    return;
  }

  if (targetType === "comment") {
    if (action === "restore") {
      await db
        .prepare("UPDATE comments SET status = 'visible', hidden_at = NULL, hidden_reason = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(now, targetId)
        .run();
      return;
    }

    if (action === "delete") {
      await db
        .prepare("UPDATE comments SET status = 'deleted', hidden_at = ?, hidden_reason = ?, deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, reason, now, now, targetId)
        .run();
      return;
    }

    await db
      .prepare("UPDATE comments SET status = 'hidden', hidden_at = ?, hidden_reason = ?, updated_at = ? WHERE id = ?")
      .bind(now, reason, now, targetId)
      .run();
    return;
  }

  if (action === "restore") {
    await db.prepare("UPDATE photos SET hidden_at = NULL WHERE id = ? AND deleted_at IS NULL").bind(targetId).run();
    return;
  }

  if (action === "delete") {
    await db.prepare("UPDATE photos SET hidden_at = ?, deleted_at = ? WHERE id = ?").bind(now, now, targetId).run();
    return;
  }

  await db.prepare("UPDATE photos SET hidden_at = ? WHERE id = ?").bind(now, targetId).run();
}

async function recordAdminAction(
  db: D1Database,
  request: Request,
  action: AdminActionType,
  targetType: ReportRecord["targetType"] | "anonymous_user",
  targetId: string,
  reason: string | null,
): Promise<void> {
  await db
    .prepare("INSERT INTO admin_actions (id, admin_subject, action_type, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(`admin_${crypto.randomUUID()}`, adminSubject(request), action, targetType, targetId, reason, new Date().toISOString())
    .run();
}

async function getD1InteractionId(
  db: D1Database,
  anonymousUserId: string,
  targetType: "place" | "comment" | "photo",
  targetId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM likes WHERE anonymous_user_id = ? AND target_type = ? AND target_id = ? LIMIT 1")
    .bind(anonymousUserId, targetType, targetId)
    .first<{ id: string }>();

  return row?.id ?? null;
}

async function createD1UniqueInteraction(
  db: D1Database,
  anonymousUserId: string,
  targetType: "place" | "comment" | "photo",
  targetId: string,
): Promise<boolean> {
  const existing = await getD1InteractionId(db, anonymousUserId, targetType, targetId);
  if (existing) {
    return false;
  }

  await db
    .prepare("INSERT INTO likes (id, anonymous_user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(`like_${crypto.randomUUID()}`, anonymousUserId, targetType, targetId, new Date().toISOString())
    .run();

  return true;
}

async function countD1Interactions(db: D1Database, targetType: "place" | "comment" | "photo", targetId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM likes WHERE target_type = ? AND target_id = ?")
    .bind(targetType, targetId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1VisibleComments(db: D1Database, placeId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM comments
       WHERE place_id = ?
         AND status = 'visible'
         AND hidden_at IS NULL
         AND deleted_at IS NULL
         AND created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`,
    )
    .bind(placeId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1VisiblePhotos(db: D1Database, placeId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM photos
       WHERE place_id = ?
         AND status = 'ready'
         AND hidden_at IS NULL
         AND deleted_at IS NULL
         AND created_at > ${D1_ACTIVE_CONTENT_CUTOFF_SQL}`,
    )
    .bind(placeId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1OpenReportsForTarget(db: D1Database, targetType: ReportRecord["targetType"], targetId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM reports WHERE target_type = ? AND target_id = ? AND status = 'open'")
    .bind(targetType, targetId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1Events(db: D1Database, placeId: string, eventType: "click" | "like" | "comment" | "photo" | "report"): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM place_events
       WHERE place_id = ?
         AND event_type = ?
         AND expires_at > ${D1_NOW_SQL}`,
    )
    .bind(placeId, eventType)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function countD1UniqueEventUsers(db: D1Database, placeId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT anonymous_user_id) AS count
       FROM place_events
       WHERE place_id = ?
         AND expires_at > ${D1_NOW_SQL}`,
    )
    .bind(placeId)
    .first<D1CountRow>();

  return row?.count ?? 0;
}

async function d1RankingCounts(db: D1Database, placeId: string): Promise<RankingCounts> {
  const [clickCount, likeCount, commentCount, photoCount, reportCount, uniqueUserCount] = await Promise.all([
    countD1Events(db, placeId, "click"),
    countD1Interactions(db, "place", placeId),
    countD1VisibleComments(db, placeId),
    countD1VisiblePhotos(db, placeId),
    countD1OpenReportsForTarget(db, "place", placeId),
    countD1UniqueEventUsers(db, placeId),
  ]);

  return { clickCount, likeCount, commentCount, photoCount, reportCount, uniqueUserCount };
}

async function recordD1PlaceEvent(
  db: D1Database,
  place: PlaceRecord,
  anonymousUserId: string,
  eventType: "click" | "like" | "comment" | "photo" | "report",
): Promise<void> {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + REPORT_TTL_MS).toISOString();
  const eventId = `event_${crypto.randomUUID()}`;
  await db
    .prepare(
      `INSERT INTO place_events
        (id, place_id, anonymous_user_id, event_type, source, region_code, area_code, category, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'worker_api', ?, ?, ?, ?, ?)`,
    )
    .bind(eventId, place.id, anonymousUserId, eventType, place.regionId, place.areaId, place.categoryId, createdAt, expiresAt)
    .run();
  await incrementD1HourlyAggregate(db, place, eventType, createdAt);
}

async function incrementD1HourlyAggregate(
  db: D1Database,
  place: PlaceRecord,
  eventType: "click" | "like" | "comment" | "photo" | "report",
  createdAt: string,
): Promise<void> {
  const hourBucket = createdAt.slice(0, 13) + ":00:00.000Z";
  const nextHourBucket = new Date(new Date(hourBucket).getTime() + 60 * 60 * 1000).toISOString();
  const column = `${eventType}_count`;
  await db
    .prepare(
      `INSERT INTO place_event_hourly
        (id, place_id, region_code, area_code, category, hour_bucket, ${column}, unique_user_count)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)
       ON CONFLICT(place_id, hour_bucket) DO UPDATE SET
         ${column} = ${column} + 1,
         unique_user_count = unique_user_count + 1`,
    )
    .bind(`hour_${crypto.randomUUID()}`, place.id, place.regionId, place.areaId, place.categoryId, hourBucket)
    .run();
  await db
    .prepare(
      `UPDATE place_event_hourly
       SET unique_user_count = (
         SELECT COUNT(DISTINCT anonymous_user_id)
         FROM place_events
         WHERE place_id = ?
           AND created_at >= ?
           AND created_at < ?
       )
       WHERE place_id = ? AND hour_bucket = ?`,
    )
    .bind(place.id, hourBucket, nextHourBucket, place.id, hourBucket)
    .run();
}

async function incrementD1ReportCounter(db: D1Database, targetType: ReportRecord["targetType"], targetId: string): Promise<void> {
  if (targetType === "comment") {
    await db.prepare("UPDATE comments SET report_count = report_count + 1, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), targetId).run();
    return;
  }

  if (targetType === "photo") {
    await db.prepare("UPDATE photos SET report_count = report_count + 1 WHERE id = ?").bind(targetId).run();
  }
}

async function applyD1ProtectionForReport(db: D1Database, report: Pick<ReportRecord, "targetType" | "targetId" | "reason">): Promise<void> {
  const shouldHideImmediately =
    report.reason === "privacy_face" || report.reason === "privacy_plate" || report.reason === "sensitive_info";
  const openReportCount = await countD1OpenReportsForTarget(db, report.targetType, report.targetId);
  if (!shouldHideImmediately && openReportCount < 3) {
    return;
  }

  const now = new Date().toISOString();
  const reason = shouldHideImmediately ? `auto_${report.reason}` : "auto_report_threshold";
  if (report.targetType === "comment") {
    await db.prepare("UPDATE comments SET status = 'hidden', hidden_at = ?, hidden_reason = ?, updated_at = ? WHERE id = ?").bind(now, reason, now, report.targetId).run();
  }

  if (report.targetType === "photo") {
    await db.prepare("UPDATE photos SET hidden_at = ? WHERE id = ?").bind(now, report.targetId).run();
  }
}

function d1ModerationPriority(reason: ReportRecord["reason"]): "normal" | "high" | "urgent" {
  if (reason === "sensitive_info") {
    return "urgent";
  }

  if (reason === "privacy_face" || reason === "privacy_plate") {
    return "high";
  }

  return "normal";
}

function enqueueModerationAlert(
  ctx: ExecutionContext,
  env: Env,
  report: Pick<ReportRecord, "id" | "targetType" | "targetId" | "reason" | "createdAt">,
  priority: "normal" | "high" | "urgent",
): "webhook" | "none" {
  if (!env.MODERATION_ALERT_WEBHOOK_URL?.trim()) {
    return "none";
  }

  ctx.waitUntil(sendModerationAlert(env, report, priority).catch(() => undefined));

  return "webhook";
}

async function sendModerationAlert(
  env: Env,
  report: Pick<ReportRecord, "id" | "targetType" | "targetId" | "reason" | "createdAt">,
  priority: "normal" | "high" | "urgent",
): Promise<void> {
  const rawUrl = env.MODERATION_ALERT_WEBHOOK_URL?.trim();
  if (!rawUrl) {
    return;
  }

  const url = new URL(rawUrl);
  if (url.protocol !== "https:") {
    throw new HttpError(503, "MODERATION_ALERT_WEBHOOK_INVALID", "운영자 알림 webhook은 HTTPS만 허용합니다.");
  }

  const headers = new Headers({ "content-type": "application/json" });
  const token = env.MODERATION_ALERT_WEBHOOK_TOKEN?.trim();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const payload: ModerationAlertPayload = {
    type: "moderation.report.created",
    reportId: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    priority,
    queuePath: "/api/moderation/reports?status=open",
    environment: env.ENVIRONMENT ?? "development",
    createdAt: report.createdAt,
  };

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new HttpError(502, "MODERATION_ALERT_WEBHOOK_FAILED", "운영자 알림 webhook 전송에 실패했습니다.");
  }
}

function adminSubject(request: Request): string {
  const header = request.headers.get("x-silsigan-admin-subject")?.trim();
  if (header && /^[a-zA-Z0-9@._:-]{3,120}$/.test(header)) {
    return header;
  }

  return "admin-token";
}

async function readJson(request: Request): Promise<JsonObject> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON 요청만 지원합니다.");
  }

  const body = (await request.json()) as unknown;
  if (!isRecord(body)) {
    throw new HttpError(400, "INVALID_JSON", "JSON 객체가 필요합니다.");
  }

  return body;
}

function stringField(body: JsonObject, field: string, maxLength: number): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value.trim();
}

function commentBodyField(body: JsonObject): string {
  const value = stringField(body, "body", commentBodyMaxLength);
  if (value.length < commentBodyMinLength) {
    throw new HttpError(400, "VALIDATION_ERROR", "body 값이 올바르지 않습니다.");
  }

  const rejectionReason = commentBodyRejectionReason(value);
  if (rejectionReason) {
    throw new HttpError(400, "COMMENT_BODY_REJECTED", "댓글에 공개할 수 없는 정보나 스팸 패턴이 포함되어 있습니다.", { reason: rejectionReason });
  }

  return value;
}

function commentBodyRejectionReason(value: string): "phone" | "resident_id" | "script" | "url_spam" | null {
  const normalized = value.toLocaleLowerCase("ko-KR");
  if (/(?:\+?82[-.\s]?)?0(?:10|2|[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(value)) {
    return "phone";
  }
  if (/\b\d{6}[-\s]?[1-4]\d{6}\b/.test(value)) {
    return "resident_id";
  }
  if (/<\s*script\b|javascript\s*:|on(?:error|load|click|mouseover)\s*=/.test(normalized)) {
    return "script";
  }

  const urlMatches = value.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? [];
  const urlTextLength = urlMatches.reduce((sum, match) => sum + match.length, 0);
  if (urlMatches.length >= 2 || (urlMatches.length === 1 && urlTextLength / value.length > 0.6)) {
    return "url_spam";
  }

  return null;
}

function optionalStringField(body: JsonObject, field: string, maxLength: number): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value.trim();
}

function anonymousUserIdField(body: JsonObject, field: string): string {
  const value = stringField(body, field, 80);
  if (!/^anon_[a-f0-9]{48}$/i.test(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function optionalFutureIsoDateField(body: JsonObject, field: string): string | null {
  const value = optionalStringField(body, field, 40);
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  if (ms <= Date.now()) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값은 미래 시각이어야 합니다.`);
  }

  return new Date(ms).toISOString();
}

function bulkModerationTargetsField(body: JsonObject, maxTargets: number): AdminBulkModerationTarget[] {
  const rawTargets = body["targets"];
  if (!Array.isArray(rawTargets) || rawTargets.length < 1 || rawTargets.length > maxTargets) {
    throw new HttpError(400, "VALIDATION_ERROR", `targets는 1~${maxTargets}개 배열이어야 합니다.`);
  }

  return rawTargets.map((target, index) => {
    if (!isRecord(target)) {
      throw new HttpError(400, "VALIDATION_ERROR", `targets[${index}] 값이 올바르지 않습니다.`);
    }

    return {
      targetType: enumField(target, "targetType", ["place", "comment", "photo"] as const),
      targetId: stringField(target, "targetId", 100),
    };
  });
}

function numberField(body: JsonObject, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function coordinateField(body: JsonObject, field: string, min: number, max: number): number {
  const value = numberField(body, field);
  if (value < min || value > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function booleanField(body: JsonObject, field: string): boolean {
  const value = body[field];
  if (typeof value !== "boolean") {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value;
}

function enumField<TValue extends string>(body: JsonObject, field: string, values: readonly TValue[]): TValue {
  const value = body[field];
  if (typeof value !== "string" || !values.includes(value as TValue)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value as TValue;
}

function enumFromSearch<TValue extends string>(url: URL, field: string, values: readonly TValue[], fallback: TValue): TValue {
  const value = url.searchParams.get(field);
  if (!value) {
    return fallback;
  }

  if (!values.includes(value as TValue)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 값이 올바르지 않습니다.`);
  }

  return value as TValue;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json<TData>(data: TData, meta?: Record<string, unknown>, status = 200): Response {
  const body: ApiResponse<TData> = {
    success: true,
    data,
    ...(meta ? { meta } : {}),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  const body: ApiResponse<never> = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function errorToResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message, error.details);
  }

  if (error instanceof Error) {
    return errorResponse(400, publicErrorCode(error), "요청 정책을 만족하지 않습니다.");
  }

  return errorResponse(500, "INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다.");
}

function publicErrorCode(error: Error): string {
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message) ? error.message : "POLICY_ERROR";
}

function withHeaders(response: Response, extraHeaders: Headers): Response {
  const headers = new Headers(response.headers);
  extraHeaders.forEach((value, key) => headers.append(key, value));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-silsigan-anon-id,x-silsigan-admin-token,x-silsigan-admin-subject",
    "access-control-expose-headers": "x-silsigan-anon-id",
  };
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function clientIpHint(request: Request): string {
  const raw = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return raw ? `ip-hint:${raw.length}:${raw.charCodeAt(0)}` : "local";
}

function roomKey(scope: RoomBroadcast["scope"], roomId: string): string {
  return `${scope}:${roomId}`;
}

function getRoomEvents(key: string): RoomBroadcast[] {
  return roomEvents.get(key) ?? [];
}

function placeClickWindowsFor(anonymousUserId: string): Map<string, number> {
  const existing = placeClickWindowsByAnon.get(anonymousUserId);
  if (existing) {
    return existing;
  }

  const next = new Map<string, number>();
  placeClickWindowsByAnon.set(anonymousUserId, next);

  return next;
}

function parseRankingRoute(path: string): RankingRoute {
  if (path === "/api/rankings/global") {
    return { kind: "global", regionId: null, areaId: null, categoryId: null };
  }

  const areaMatch = path.match(/^\/api\/rankings\/regions\/([^/]+)\/areas\/([^/]+)$/);
  if (areaMatch) {
    return {
      kind: "area",
      regionId: decodeURIComponent(areaMatch[1]),
      areaId: decodeURIComponent(areaMatch[2]),
      categoryId: null,
    };
  }

  const categoryMatch = path.match(/^\/api\/rankings\/regions\/([^/]+)\/categories\/([^/]+)$/);
  if (categoryMatch) {
    return {
      kind: "category",
      regionId: decodeURIComponent(categoryMatch[1]),
      areaId: null,
      categoryId: decodeURIComponent(categoryMatch[2]),
    };
  }

  const regionMatch = path.match(/^\/api\/rankings\/regions\/([^/]+)$/);
  if (regionMatch) {
    return {
      kind: "region",
      regionId: decodeURIComponent(regionMatch[1]),
      areaId: null,
      categoryId: null,
    };
  }

  return { kind: "generic", regionId: null, areaId: null, categoryId: null };
}

function d1PlaceSelectSql(): string {
  return `
    SELECT
      p.id,
      p.name,
      p.category_id AS categoryId,
      p.area_id AS areaId,
      p.region_id AS regionId,
      p.latitude,
      p.longitude,
      p.coordinate_status AS coordinateStatus,
      CASE
        WHEN COALESCE(r.score, 0) + COALESCE(e.live_score, 0) < 0 THEN 0
        ELSE COALESCE(r.score, 0) + COALESCE(e.live_score, 0)
      END AS score,
      p.launch_stage AS status
    FROM places p
    LEFT JOIN place_rankings r
      ON r.place_id = p.id
      AND r.region_id = p.region_id
      AND r.window_hours = 24
    LEFT JOIN (
      SELECT
        place_id,
        SUM(
          CASE event_type
            WHEN 'photo' THEN 8
            WHEN 'comment' THEN 4
            WHEN 'like' THEN 2
            WHEN 'click' THEN 1
            WHEN 'report' THEN -15
            ELSE 0
          END
        ) AS live_score
      FROM place_events
      WHERE expires_at > ${D1_NOW_SQL}
      GROUP BY place_id
    ) e
      ON e.place_id = p.id
  `;
}

function d1PlacesQuery({
  areaId,
  bbox,
  categoryId,
  limit,
  query,
  regionId,
  requireRankingSignal = false,
}: {
  areaId: string | null;
  bbox: BBox | null;
  categoryId: string | null;
  limit: number;
  query: string | null | undefined;
  regionId: string | null;
  requireRankingSignal?: boolean;
}): { sql: string; values: D1Value[]; limit: number } {
  const where = ["p.is_active = 1", "p.coordinate_status = 'verified'", "p.latitude IS NOT NULL", "p.longitude IS NOT NULL"];
  const values: D1Value[] = [];

  if (bbox) {
    where.push("p.latitude BETWEEN ? AND ?");
    values.push(bbox.minLat, bbox.maxLat);
    where.push("p.longitude BETWEEN ? AND ?");
    values.push(bbox.minLng, bbox.maxLng);
  }

  if (regionId) {
    where.push("p.region_id = ?");
    values.push(regionId);
  }

  if (areaId) {
    where.push("p.area_id = ?");
    values.push(areaId);
  }

  if (categoryId) {
    where.push("p.category_id = ?");
    values.push(categoryId);
  }

  if (query) {
    where.push("LOWER(p.name) LIKE ?");
    values.push(`%${query}%`);
  }

  if (requireRankingSignal) {
    where.push("(COALESCE(r.score, 0) > 0 OR COALESCE(e.live_score, 0) > 0)");
  }

  values.push(limit);

  return {
    sql: `${d1PlaceSelectSql()}
      WHERE ${where.join(" AND ")}
      ORDER BY score DESC, p.name ASC
      LIMIT ?`,
    values,
    limit,
  };
}

function d1PlaceRowToRecord(row: D1PlaceRow): PlaceRecord {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    areaId: row.areaId,
    regionId: row.regionId,
    latitude: row.latitude,
    longitude: row.longitude,
    score: row.score ?? 0,
    status: row.status,
    coordinateStatus: row.coordinateStatus,
  };
}

function rankingRecordForPlace(place: PlaceRecord, rank: number, counts: RankingCounts): RankingRecord {
  return {
    placeId: place.id,
    name: place.name,
    regionId: place.regionId,
    regionCode: place.regionId,
    areaCode: place.areaId,
    category: place.categoryId,
    score: place.score,
    rank,
    windowHours: 24,
    clickCount: counts.clickCount,
    likeCount: counts.likeCount,
    commentCount: counts.commentCount,
    photoCount: counts.photoCount,
    reportCount: counts.reportCount,
    uniqueUserCount: counts.uniqueUserCount,
    trend: "same",
    summary: d1PlaceStatusSummary(counts.commentCount, counts.photoCount),
  };
}

function memoryRankingCounts(placeId: string): RankingCounts {
  const activeComments = comments.filter((comment) => comment.placeId === placeId && !comment.hiddenAt && isActiveRecentContent(comment.createdAt));
  const activePhotos = photos.filter(
    (photo) => photo.placeId === placeId && photo.status === "ready" && !photo.deletedAt && isActiveRecentContent(photo.createdAt),
  );
  const openPlaceReports = reports.filter((report) => report.targetType === "place" && report.targetId === placeId && report.status === "open");
  const uniqueUserIds = new Set<string>();

  for (const comment of activeComments) {
    uniqueUserIds.add(comment.anonymousUserId);
  }

  for (const photo of activePhotos) {
    uniqueUserIds.add(photo.anonymousUserId);
  }

  for (const report of openPlaceReports) {
    uniqueUserIds.add(report.anonymousUserId);
  }

  return {
    clickCount: placeClickCounts.get(placeId) ?? 0,
    likeCount: placeLikeCounts.get(placeId) ?? 0,
    commentCount: activeComments.length,
    photoCount: activePhotos.length,
    reportCount: openPlaceReports.length,
    uniqueUserCount: uniqueUserIds.size,
  };
}

function placeStatusSummary(place: PlaceRecord): string {
  const commentCount = comments.filter((comment) => comment.placeId === place.id && !comment.hiddenAt && isActiveRecentContent(comment.createdAt)).length;
  const photoCount = photos.filter((photo) => photo.placeId === place.id && photo.status === "ready" && !photo.deletedAt && isActiveRecentContent(photo.createdAt)).length;
  return d1PlaceStatusSummary(commentCount, photoCount);
}

function isActiveRecentContent(createdAt: string, now = new Date()): boolean {
  const createdAtMs = new Date(createdAt).getTime();
  return Number.isFinite(createdAtMs) && createdAtMs > now.getTime() - REPORT_TTL_MS;
}

function d1PlaceStatusSummary(commentCount: number, photoCount: number): string {
  if (commentCount === 0 && photoCount === 0) {
    return "정보 없음";
  }

  return `댓글 ${commentCount}개 · 사진 ${photoCount}장 · 실시간 사용자 제보 기반`;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const testExecutionContext: ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void {
    void promise;
  },
};
