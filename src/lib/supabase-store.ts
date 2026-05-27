import {
  type FlagReason,
  type Place,
  type StoredHashtag,
  type StoredPost,
  buildShareCard,
  classifyHashtag,
  creditEventsForReport,
  distanceMeters,
  getCategorySafetyWarning,
  rankPostsForFeed,
  recommendHashtags,
  shouldHideForFlags,
  uniqueHashtags,
  verifiedRadiusFromDistance,
} from "./domain.ts";
import { ApiError } from "./errors.ts";
import { getSupabaseServiceClient } from "./supabase-server.ts";
import type { SilsiganStore } from "./store.ts";
import type { CreatePostInput, FlagPostInput } from "./validators.ts";

type PlaceRow = {
  id: string;
  name: string;
  address: string;
  category: Place["category"];
  latitude: number | string;
  longitude: number | string;
  region: Place["region"];
};

type PostRow = {
  id: string;
  user_id: string | null;
  creator_name: string;
  creator_badge: string;
  place_id: string;
  caption: string | null;
  crowd_level: StoredPost["crowdLevel"];
  parking_status: StoredPost["parkingStatus"];
  line_status: StoredPost["lineStatus"];
  weather_feel: StoredPost["weatherFeel"];
  location_verified: boolean;
  verified_radius_m: 50 | 150 | 300 | null;
  photo_count: number;
  photo_label: string;
  helpful_count: number;
  comment_count: number;
  hidden_at: string | null;
  created_at: string;
};

type HashtagRow = {
  id: string;
  name: string;
  tag_type: StoredHashtag["tagType"];
  post_count: number;
  created_at: string;
};

type PostHashtagRow = {
  post_id: string;
  hashtag_id: string;
};

type FlagRow = {
  post_id: string;
  reason: FlagReason;
};

export function createSupabaseStore(): SilsiganStore {
  return {
    createPost,
    flagPost,
    listHashtags,
    listPostModerationQueue,
    listPosts,
    moderatePost,
  };
}

async function listPosts(filters: { placeId?: string; hashtagName?: string; includeHidden?: boolean } = {}) {
  const client = getSupabaseServiceClient();
  let query = client.from("silsigan_posts").select("*");

  if (filters.placeId) {
    query = query.eq("place_id", filters.placeId);
  }

  if (!filters.includeHidden) {
    query = query.is("hidden_at", null);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  assertNoError(error);
  let posts = ((data ?? []) as PostRow[]).map(postFromRow);

  if (filters.hashtagName) {
    const postIds = await postIdsForHashtag(filters.hashtagName);
    posts = posts.filter((post) => postIds.has(post.id));
  }

  return publicPosts(posts);
}

async function listHashtags(): Promise<StoredHashtag[]> {
  const client = getSupabaseServiceClient();
  const { data, error } = await client.from("silsigan_hashtags").select("*").order("post_count", { ascending: false });
  assertNoError(error);

  return ((data ?? []) as HashtagRow[]).map(hashtagFromRow);
}

async function createPost(input: CreatePostInput) {
  const client = getSupabaseServiceClient();
  const place = await findPlace(input.placeId);
  const verifiedRadiusM = verifiedRadiusForInput(place, input.clientLocation);
  const recommendedHashtags = recommendHashtags({
    place,
    crowdLevel: input.crowdLevel,
    parkingStatus: input.parkingStatus,
    lineStatus: input.lineStatus,
    weatherFeel: input.weatherFeel,
  });
  const hashtagNames = uniqueHashtags([...input.hashtagNames, ...recommendedHashtags]).slice(0, 5);
  const photoLabel = input.photoCount > 0 ? `${place.name} 현장 사진` : "상태 제보";

  const { data, error } = await client
    .from("silsigan_posts")
    .insert({
      creator_name: "실시간러버",
      creator_badge: place.region === "busan" ? "부산 현장러" : place.region === "gyeongju" ? "경주 골목러" : "울산 현장러",
      place_id: input.placeId,
      caption: input.caption || null,
      crowd_level: input.crowdLevel,
      parking_status: input.parkingStatus,
      line_status: input.lineStatus,
      weather_feel: input.weatherFeel,
      location_verified: Boolean(verifiedRadiusM),
      verified_radius_m: verifiedRadiusM,
      photo_count: input.photoCount,
      photo_label: photoLabel,
    })
    .select("*")
    .single();
  assertNoError(error);

  const post = postFromRow(data as PostRow);
  const hashtags = await upsertHashtags(hashtagNames);
  if (hashtags.length > 0) {
    const { error: joinError } = await client.from("silsigan_post_hashtags").insert(
      hashtags.map((hashtag) => ({
        post_id: post.id,
        hashtag_id: hashtag.id,
      })),
    );
    assertNoError(joinError);
    await refreshHashtagCounts(hashtags.map((hashtag) => hashtag.id));
  }

  const [publicPost] = await publicPosts([{ ...post, hashtagNames }]);

  return {
    post: publicPost,
    credits: creditEventsForReport(Boolean(verifiedRadiusM), input.photoCount > 0),
    recommendedHashtags,
    safetyWarning: getCategorySafetyWarning(place.category),
    privacyNotice: "정확한 좌표와 EXIF는 저장하지 않고 장소 반경 검증과 안전 처리 상태만 남깁니다.",
  };
}

async function flagPost(input: FlagPostInput) {
  const client = getSupabaseServiceClient();
  const post = await findPost(input.postId);
  const { error } = await client.from("silsigan_post_flags").insert({
    post_id: input.postId,
    reason: input.reason,
    note: input.note ?? null,
  });
  assertNoError(error);

  const { data: flags, error: flagsError } = await client.from("silsigan_post_flags").select("reason").eq("post_id", input.postId);
  assertNoError(flagsError);
  const reasons = ((flags ?? []) as Pick<FlagRow, "reason">[]).map((flag) => flag.reason);

  if (!post.hiddenAt && shouldHideForFlags(reasons)) {
    const { error: hideError } = await client.from("silsigan_posts").update({ hidden_at: new Date().toISOString() }).eq("id", input.postId);
    assertNoError(hideError);
  }

  return {
    postId: input.postId,
    hidden: post.hiddenAt !== null || shouldHideForFlags(reasons),
    flagCount: reasons.length,
    hideRule: "얼굴/차량번호/민감정보 신고 1건, 허위 2건, 전체 신고 3건 이상이면 임시 숨김 처리",
  };
}

async function listPostModerationQueue(filters: { reason?: FlagReason | "hidden" } = {}) {
  const posts = await listPosts({ includeHidden: true });
  const client = getSupabaseServiceClient();
  const { data, error } = await client.from("silsigan_post_flags").select("post_id, reason");
  assertNoError(error);
  const flags = ((data ?? []) as FlagRow[]).reduce<Map<string, FlagReason[]>>((map, flag) => {
    map.set(flag.post_id, [...(map.get(flag.post_id) ?? []), flag.reason]);
    return map;
  }, new Map());

  return posts
    .map((post) => ({
      post,
      place: placeSummaryForPost(post),
      flagReasons: flags.get(post.id) ?? [],
      flagCount: flags.get(post.id)?.length ?? 0,
      hidden: Boolean(post.hiddenAt),
      recommendedAction: moderationRecommendation(flags.get(post.id) ?? [], Boolean(post.hiddenAt)),
    }))
    .filter((item) => {
      if (filters.reason === "hidden") return item.hidden;
      if (filters.reason) return item.flagReasons.includes(filters.reason);
      return item.flagCount > 0 || item.hidden;
    });
}

async function moderatePost(input: { postId: string; action: "keep" | "hide" | "delete" | "restrict_author" }) {
  const client = getSupabaseServiceClient();

  if (input.action === "keep") {
    const { error } = await client.from("silsigan_post_flags").delete().eq("post_id", input.postId);
    assertNoError(error);
  }

  if (input.action === "hide" || input.action === "delete") {
    const { error } = await client.from("silsigan_posts").update({ hidden_at: new Date().toISOString() }).eq("id", input.postId);
    assertNoError(error);
  }

  const { error: auditError } = await client.from("silsigan_admin_audit").insert({
    actor: "admin-token",
    action: input.action,
    post_id: input.postId,
  });
  assertNoError(auditError);

  return {
    postId: input.postId,
    action: input.action,
    hidden: input.action === "hide" || input.action === "delete",
    note: "Supabase 운영 액션이 처리됐습니다.",
  };
}

async function publicPosts(posts: StoredPost[]) {
  const hashtagMap = await hashtagsForPosts(posts.map((post) => post.id));
  const places = await placesForPosts(posts);

  return rankPostsForFeed(posts).map((post) => {
    const place = places.get(post.placeId) ?? placeSummaryForPost(post);
    const hashtagNames = hashtagMap.get(post.id) ?? post.hashtagNames;
    const postWithTags = { ...post, hashtagNames };
    const shareCard = buildShareCard(postWithTags, place);

    return {
      ...postWithTags,
      hashtags: hashtagNames.map((name) => ({
        id: `hashtag_${name}`,
        name,
        tagType: classifyHashtag(name),
        postCount: 0,
        createdAt: post.createdAt,
      })),
      shareCard,
      judgement: shareCard.headline.replace(`${place.name} `, ""),
      safetyWarning: getCategorySafetyWarning(place.category),
    };
  });
}

async function upsertHashtags(names: string[]) {
  if (names.length === 0) return [];

  const client = getSupabaseServiceClient();
  const rows = names.map((name) => ({
    name,
    tag_type: classifyHashtag(name),
  }));
  const { data, error } = await client.from("silsigan_hashtags").upsert(rows, { onConflict: "name" }).select("*");
  assertNoError(error);

  return ((data ?? []) as HashtagRow[]).map(hashtagFromRow);
}

async function refreshHashtagCounts(hashtagIds: string[]) {
  const client = getSupabaseServiceClient();

  await Promise.all(
    hashtagIds.map(async (hashtagId) => {
      const { count, error } = await client
        .from("silsigan_post_hashtags")
        .select("*", { count: "exact", head: true })
        .eq("hashtag_id", hashtagId);
      assertNoError(error);
      const { error: updateError } = await client.from("silsigan_hashtags").update({ post_count: count ?? 0 }).eq("id", hashtagId);
      assertNoError(updateError);
    }),
  );
}

async function postIdsForHashtag(name: string) {
  const client = getSupabaseServiceClient();
  const { data: hashtag, error: hashtagError } = await client.from("silsigan_hashtags").select("id").eq("name", name).maybeSingle();
  assertNoError(hashtagError);
  if (!hashtag) return new Set<string>();

  const { data, error } = await client.from("silsigan_post_hashtags").select("post_id").eq("hashtag_id", (hashtag as { id: string }).id);
  assertNoError(error);

  return new Set(((data ?? []) as Pick<PostHashtagRow, "post_id">[]).map((row) => row.post_id));
}

async function hashtagsForPosts(postIds: string[]) {
  if (postIds.length === 0) return new Map<string, string[]>();
  const client = getSupabaseServiceClient();
  const { data: joins, error: joinsError } = await client.from("silsigan_post_hashtags").select("post_id, hashtag_id").in("post_id", postIds);
  assertNoError(joinsError);
  const joinRows = (joins ?? []) as PostHashtagRow[];
  const hashtagIds = [...new Set(joinRows.map((row) => row.hashtag_id))];
  if (hashtagIds.length === 0) return new Map<string, string[]>();

  const { data: hashtags, error } = await client.from("silsigan_hashtags").select("*").in("id", hashtagIds);
  assertNoError(error);
  const hashtagById = new Map(((hashtags ?? []) as HashtagRow[]).map((row) => [row.id, row.name]));

  return joinRows.reduce<Map<string, string[]>>((map, row) => {
    const name = hashtagById.get(row.hashtag_id);
    if (!name) return map;
    map.set(row.post_id, [...(map.get(row.post_id) ?? []), name]);
    return map;
  }, new Map());
}

async function placesForPosts(posts: StoredPost[]) {
  const ids = [...new Set(posts.map((post) => post.placeId))];
  if (ids.length === 0) return new Map<string, Place>();
  const client = getSupabaseServiceClient();
  const { data, error } = await client.from("silsigan_places").select("*").in("id", ids);
  assertNoError(error);

  return new Map(((data ?? []) as PlaceRow[]).map((row) => [row.id, placeFromRow(row)]));
}

async function findPlace(placeId: string): Promise<Place> {
  const client = getSupabaseServiceClient();
  const { data, error } = await client.from("silsigan_places").select("*").eq("id", placeId).single();
  assertNoError(error);

  return placeFromRow(data as PlaceRow);
}

async function findPost(postId: string): Promise<StoredPost> {
  const client = getSupabaseServiceClient();
  const { data, error } = await client.from("silsigan_posts").select("*").eq("id", postId).single();
  assertNoError(error);

  return postFromRow(data as PostRow);
}

function verifiedRadiusForInput(place: Place, clientLocation: CreatePostInput["clientLocation"]) {
  if (!clientLocation) {
    return null;
  }

  return verifiedRadiusFromDistance(
    distanceMeters(clientLocation, {
      latitude: place.latitude,
      longitude: place.longitude,
    }),
  );
}

function placeFromRow(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    category: row.category,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    region: row.region,
  };
}

function postFromRow(row: PostRow): StoredPost {
  return {
    id: row.id,
    userId: row.user_id ?? "anonymous",
    creatorName: row.creator_name,
    creatorBadge: row.creator_badge,
    placeId: row.place_id,
    caption: row.caption,
    crowdLevel: row.crowd_level,
    parkingStatus: row.parking_status,
    lineStatus: row.line_status,
    weatherFeel: row.weather_feel,
    locationVerified: row.location_verified,
    verifiedRadiusM: row.verified_radius_m,
    photoCount: row.photo_count,
    photoLabel: row.photo_label,
    helpfulCount: row.helpful_count,
    commentCount: row.comment_count,
    hashtagNames: [],
    hiddenAt: row.hidden_at,
    createdAt: row.created_at,
  };
}

function hashtagFromRow(row: HashtagRow): StoredHashtag {
  return {
    id: row.id,
    name: row.name,
    tagType: row.tag_type,
    postCount: row.post_count,
    createdAt: row.created_at,
  };
}

function placeSummaryForPost(post: Pick<StoredPost, "placeId">): Place {
  return {
    id: post.placeId,
    name: post.placeId,
    address: "장소 정보 확인 필요",
    category: "tourism",
    latitude: 35.5486,
    longitude: 129.3005,
    region: "ulsan",
  };
}

function moderationRecommendation(reasons: FlagReason[], hidden: boolean) {
  if (hidden) return "이미 임시 숨김";
  if (reasons.some((reason) => ["privacy_face", "privacy_plate", "sensitive_info"].includes(reason))) return "즉시 숨김 검토";
  if (reasons.includes("false_content")) return "현장성 재검증";
  if (reasons.includes("spam")) return "작성자 제한 검토";
  return "운영자 확인";
}

function assertNoError(error: { message: string } | null) {
  if (error) {
    throw new ApiError(500, "SUPABASE_QUERY_FAILED", error.message);
  }
}
