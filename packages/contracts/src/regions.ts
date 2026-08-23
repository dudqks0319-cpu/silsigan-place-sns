export const KOREA_SIDO_REGIONS = [
  { id: "seoul", name: "서울", placeRegionIds: ["seoul"] },
  { id: "busan", name: "부산", placeRegionIds: ["busan"] },
  { id: "daegu", name: "대구", placeRegionIds: ["daegu"] },
  { id: "incheon", name: "인천", placeRegionIds: ["incheon"] },
  { id: "gwangju", name: "광주", placeRegionIds: ["gwangju"] },
  { id: "daejeon", name: "대전", placeRegionIds: ["daejeon"] },
  { id: "ulsan", name: "울산", placeRegionIds: ["ulsan"] },
  { id: "sejong", name: "세종", placeRegionIds: ["sejong"] },
  { id: "gyeonggi", name: "경기", placeRegionIds: ["gyeonggi"] },
  { id: "gangwon", name: "강원", placeRegionIds: ["gangwon", "gangneung", "sokcho"] },
  { id: "chungbuk", name: "충북", placeRegionIds: ["chungbuk"] },
  { id: "chungnam", name: "충남", placeRegionIds: ["chungnam"] },
  { id: "jeonbuk", name: "전북", placeRegionIds: ["jeonbuk", "jeonju"] },
  { id: "jeonnam", name: "전남", placeRegionIds: ["jeonnam", "yeosu"] },
  { id: "gyeongbuk", name: "경북", placeRegionIds: ["gyeongbuk", "gyeongju", "pohang"] },
  { id: "gyeongnam", name: "경남", placeRegionIds: ["gyeongnam", "changwon", "gimhae", "yangsan"] },
  { id: "jeju", name: "제주", placeRegionIds: ["jeju"] },
] as const;

export type KoreaSidoId = (typeof KOREA_SIDO_REGIONS)[number]["id"];
export type KoreaPlaceRegionId = KoreaSidoId | (typeof KOREA_SIDO_REGIONS)[number]["placeRegionIds"][number];
export type KoreaRegionScopeId = "nationwide" | KoreaSidoId;

const sidoRegionById = new Map<string, (typeof KOREA_SIDO_REGIONS)[number]>(
  KOREA_SIDO_REGIONS.map((region) => [region.id, region]),
);
const koreaPlaceRegionIds = new Set<string>(KOREA_SIDO_REGIONS.flatMap((region) => [...region.placeRegionIds]));

export function isKoreaSidoId(value: string): value is KoreaSidoId {
  return sidoRegionById.has(value);
}

export function isKoreaPlaceRegionId(value: string): value is KoreaPlaceRegionId {
  return koreaPlaceRegionIds.has(value);
}

export function placeRegionIdsForScope(scopeId: string | null | undefined): readonly string[] {
  const normalized = scopeId?.trim();
  if (!normalized || normalized === "nationwide") {
    return [];
  }

  return sidoRegionById.get(normalized)?.placeRegionIds ?? [normalized];
}

export function placeRegionMatchesScope(placeRegionId: string, scopeId: string | null | undefined): boolean {
  const regionIds = placeRegionIdsForScope(scopeId);
  return regionIds.length === 0 || regionIds.includes(placeRegionId);
}
