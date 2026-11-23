import { fail, ok } from "@/lib/api";
import { assertLegacyWriteAllowed, isCommunityReadEnabled, isRecentPublicPost } from "@/lib/legacy-access";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { store } from "@/lib/store";
import { createPostSchema, listPostsSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    if (!isCommunityReadEnabled()) {
      return ok([], { status: "unavailable", live: false, source: "community", message: "현장 제보 조회 연결을 준비하고 있어요." });
    }
    const url = new URL(request.url);
    const filters = listPostsSchema.parse({
      placeId: url.searchParams.get("placeId") ?? undefined,
      hashtagName: url.searchParams.get("hashtagName") ?? undefined,
      includeHidden: false,
    });

    const now = new Date();
    const posts = (await store.listPosts({ ...filters, includeHidden: false })).filter((post) => isRecentPublicPost(post, now));
    return ok(posts, {
      status: "available", live: false, source: "community", maxAgeMinutes: 180,
      message: "최근 3시간 이내의 이용자 제보입니다. 현장 상황과 정확성은 별도로 검증되지 않았습니다.",
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLegacyWriteAllowed();
    assertRateLimit({ key: rateLimitKey(request, "create-post"), limit: 12, windowMs: 60_000 });
    const input = createPostSchema.parse(await request.json());

    return ok(await store.createPost(input));
  } catch (error) {
    return fail(error);
  }
}
