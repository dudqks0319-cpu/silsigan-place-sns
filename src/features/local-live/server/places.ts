import { z } from "zod";
import type { DataResult, LocalPlace, PlaceCategory, Region, SourceInfo } from "../types.ts";
import { credentialId, missing, numeric, plusMinutes, unavailable, type ProviderRuntime } from "./runtime.ts";

const SOURCE: SourceInfo = { name: "카카오 로컬", url: "https://developers.kakao.com/docs/ko/local/dev-guide", kind: "directory" };
const codes = { attraction: "AT4", restaurant: "FD6", cafe: "CE7", parking: "PK6" } as const;
const categories = Object.keys(codes) as Array<keyof typeof codes>;
const documentSchema = z.object({
  id: z.string().regex(/^\d+$/).max(30), place_name: z.string().trim().min(1).max(200),
  address_name: z.string().max(300), road_address_name: z.string().max(300).optional(),
  category_name: z.string().max(300), category_group_code: z.string().max(10).optional(),
  x: z.union([z.string(), z.number()]), y: z.union([z.string(), z.number()]), phone: z.string().max(50).optional(),
});
const responseSchema = z.object({ documents: z.array(documentSchema).max(15) });
type KakaoDocument = z.infer<typeof documentSchema>;

function inferCategory(document: KakaoDocument, requested: PlaceCategory): Exclude<PlaceCategory, "all"> {
  if (requested === "family") return "family";
  return categories.find((category) => codes[category] === document.category_group_code) ?? (requested === "all" ? "attraction" : requested);
}

function localPlace(document: KakaoDocument, category: PlaceCategory): LocalPlace | null {
  const latitude = numeric(document.y, 32, 40);
  const longitude = numeric(document.x, 123, 133);
  if (latitude === null || longitude === null) return null;
  // Build the canonical provider URL from its numeric ID; never relay an upstream arbitrary URL.
  const sourceUrl = `https://place.map.kakao.com/${document.id}`;
  return {
    id: `kakao-${document.id}`, name: document.place_name,
    category: inferCategory(document, category), categoryLabel: document.category_name.split(" > ").at(-1) || "장소",
    address: document.road_address_name || document.address_name,
    latitude, longitude, phone: document.phone?.trim() || null,
    sourceName: "카카오 로컬", sourceUrl, mapUrl: sourceUrl,
  };
}

export function createPlacesProvider(runtime: ProviderRuntime) {
  async function search(region: Region, category: PlaceCategory, query: string, key: string): Promise<LocalPlace[]> {
    const isKeyword = Boolean(query) || category === "family";
    const url = new URL(`https://dapi.kakao.com/v2/local/search/${isKeyword ? "keyword" : "category"}.json`);
    const parameters = new URLSearchParams({ x: String(region.longitude), y: String(region.latitude), radius: "20000", page: "1", size: "15", sort: "distance" });
    if (isKeyword) parameters.set("query", category === "family" ? `어린이 ${query}`.trim() : query);
    if (category in codes) parameters.set("category_group_code", codes[category as keyof typeof codes]);
    url.search = parameters.toString();
    const result = responseSchema.parse(await runtime.json(url, { Authorization: `KakaoAK ${key}` }));
    const mapped = result.documents.map((document) => localPlace(document, category)).filter((place): place is LocalPlace => place !== null);
    if (result.documents.length && !mapped.length) throw new Error("Invalid place coordinates");
    return mapped;
  }

  return async (region: Region, category: PlaceCategory, rawQuery: string): Promise<DataResult<LocalPlace[]>> => {
    const key = runtime.env.KAKAO_REST_API_KEY?.trim();
    if (!key) return missing(SOURCE, "주변 장소 검색 연결을 준비하고 있어요.");
    const query = rawQuery.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!["all", ...categories, "family"].includes(category)) return unavailable(SOURCE, runtime.now(), "지원하지 않는 장소 분류입니다.");
    const id = `places:${region.id}:${region.latitude}:${region.longitude}:${category}:${query}:${credentialId(key)}`;
    return runtime.cached(id, 10 * 60_000, async () => {
      try {
        let data: LocalPlace[];
        let partial = false;
        if (category === "all" && !query) {
          const results = await Promise.allSettled(categories.map((item) => search(region, item, "", key)));
          const groups = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
          if (!groups.length) throw new Error("All place categories unavailable");
          partial = groups.length < categories.length;
          // Interleave categories so the first screen is not dominated by one type of place.
          data = Array.from({ length: 5 }, (_, index) => groups.map((group) => group[index])).flat().filter((place): place is LocalPlace => Boolean(place));
        } else {
          data = await search(region, category, query, key);
        }
        data = [...new Map(data.map((place) => [place.id, place])).values()];
        const fetchedAt = runtime.now().toISOString();
        return { status: "fresh", data, source: SOURCE, observedAt: null, fetchedAt, expiresAt: plusMinutes(fetchedAt, 10),
          message: `${partial ? "일부 분류를 불러오지 못해 확인된 결과만 표시합니다. " : ""}${category === "family" ? "지역 중심 20km 안의 ‘어린이’ 검색 결과입니다. 유아시설·이용 가능 여부는 장소에 확인해 주세요." : "지역 중심 20km 안의 장소 정보입니다. 영업 여부·혼잡도·주차 잔여 대수는 제공하지 않습니다."}` };
      } catch {
        return unavailable(SOURCE, runtime.now(), "주변 장소 정보를 일시적으로 불러오지 못했어요.");
      }
    });
  };
}
