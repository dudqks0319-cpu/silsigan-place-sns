import { fail, ok, ApiError } from "@/lib/api";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { fetchCachedNaverLocalSearch } from "@/lib/naver-local-search";

export async function GET(request: Request) {
  try {
    const costGuardKey = await rateLimitKey(request, "naver-local-search");
    assertRateLimit({ key: `${costGuardKey}:minute`, limit: 10, windowMs: 60_000 });
    assertRateLimit({ key: `${costGuardKey}:daily`, limit: 200, windowMs: 24 * 60 * 60_000 });
    const query = new URL(request.url).searchParams.get("query")?.trim();

    if (!query) {
      throw new ApiError(400, "QUERY_REQUIRED", "검색어가 필요합니다.");
    }
    if (query.length > 80) {
      throw new ApiError(400, "QUERY_TOO_LONG", "검색어는 80자 이하로 입력해 주세요.");
    }
    if (process.env.SILSIGAN_NAVER_SEARCH_ENABLED === "false") {
      throw new ApiError(503, "NAVER_SEARCH_PAUSED", "장소 검색이 비용 보호 설정으로 잠시 중지되었습니다.");
    }

    const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
    const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new ApiError(503, "NAVER_SEARCH_NOT_CONFIGURED", "네이버 장소 검색 API 설정이 필요합니다.");
    }

    const response = ok(await fetchCachedNaverLocalSearch(query, { clientId, clientSecret }));
    response.headers.set("cache-control", "private, max-age=60");
    return response;
  } catch (error) {
    return fail(error);
  }
}
