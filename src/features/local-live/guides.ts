import type { LocalPlace, PlaceCategory } from "./types.ts";

// Existing repository's place directory. This is not a live feed and has no
// crowd, business-hour, parking, baby-care, or weather claims.
const GUIDES: Record<string, Omit<LocalPlace, "sourceUrl" | "mapUrl">[]> = {
  ulsan: [{ id: "ulsan-taehwagang", name: "태화강 국가정원", category: "attraction", categoryLabel: "관광지", address: "울산 중구 태화강국가정원길", latitude: 35.5486, longitude: 129.3005, phone: null, sourceName: "기본 장소 안내 · 실시간 정보 아님" }],
  busan: [{ id: "busan-gwangalli", name: "광안리해수욕장", category: "attraction", categoryLabel: "관광지", address: "부산 수영구 광안해변로", latitude: 35.1532, longitude: 129.1186, phone: null, sourceName: "기본 장소 안내 · 실시간 정보 아님" }],
  gyeongju: [{ id: "gyeongju-hwangridan", name: "황리단길", category: "attraction", categoryLabel: "거리", address: "경북 경주시 포석로", latitude: 35.8382, longitude: 129.2098, phone: null, sourceName: "기본 장소 안내 · 실시간 정보 아님" }],
};

export function getGuidePlaces(regionId: string, category: PlaceCategory, query: string): LocalPlace[] {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  return (GUIDES[regionId] ?? [])
    .filter((place) => (category === "all" || category === place.category) && `${place.name} ${place.address}`.toLocaleLowerCase("ko-KR").includes(normalized))
    .map((place) => {
      const mapUrl = `https://map.naver.com/p/search/${encodeURIComponent(place.name)}`;
      return { ...place, mapUrl, sourceUrl: mapUrl };
    });
}
