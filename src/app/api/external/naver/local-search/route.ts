import { fail, ok, ApiError } from "@/lib/api";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

type NaverLocalSearchItem = {
  title?: string;
  category?: string;
  roadAddress?: string;
  address?: string;
  mapx?: string;
  mapy?: string;
  link?: string;
};

export async function GET(request: Request) {
  try {
    assertRateLimit({ key: rateLimitKey(request, "naver-local-search"), limit: 30, windowMs: 60_000 });
    const query = new URL(request.url).searchParams.get("query")?.trim();

    if (!query) {
      throw new ApiError(400, "QUERY_REQUIRED", "검색어가 필요합니다.");
    }

    const clientId = process.env.NAVER_SEARCH_CLIENT_ID;
    const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new ApiError(503, "NAVER_SEARCH_NOT_CONFIGURED", "네이버 장소 검색 API 설정이 필요합니다.");
    }

    const url = new URL("https://openapi.naver.com/v1/search/local.json");
    url.searchParams.set("query", query);
    url.searchParams.set("display", "5");
    url.searchParams.set("sort", "comment");

    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new ApiError(response.status, "NAVER_SEARCH_FAILED", "네이버 장소 검색에 실패했습니다.");
    }

    const payload = (await response.json()) as { items?: NaverLocalSearchItem[] };

    return ok({
      items: (payload.items ?? []).map((item) => ({
        title: stripHtml(item.title ?? ""),
        category: item.category ?? "",
        roadAddress: item.roadAddress ?? "",
        address: item.address ?? "",
        mapx: item.mapx ?? "",
        mapy: item.mapy ?? "",
        link: item.link ?? "",
      })),
      coordinateNote: "Naver local search mapx/mapy 좌표계는 지도 표시 전 Maps Geocoder/좌표 변환으로 검증해야 합니다.",
    });
  } catch (error) {
    return fail(error);
  }
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, "");
}
