import type { Region } from "./types.ts";

// Representative city centers, not a user's location or a neighborhood-level forecast.
export const REGIONS: Region[] = [
  { id: "seoul", name: "서울", province: "서울특별시", latitude: 37.5665, longitude: 126.978, tagline: "골목부터 한강까지, 서울의 지금" },
  { id: "incheon", name: "인천", province: "인천광역시", latitude: 37.4563, longitude: 126.7052, tagline: "바다와 도시 사이, 인천의 지금" },
  { id: "suwon", name: "수원", province: "경기도", latitude: 37.2636, longitude: 127.0286, tagline: "가까운 일상 속 새로운 발견" },
  { id: "chuncheon", name: "춘천", province: "강원특별자치도", latitude: 37.8813, longitude: 127.73, tagline: "호수의 도시에서 보내는 하루" },
  { id: "gangneung", name: "강릉", province: "강원특별자치도", latitude: 37.7519, longitude: 128.8761, tagline: "동해를 곁에 두고, 강릉의 지금" },
  { id: "sokcho", name: "속초", province: "강원특별자치도", latitude: 38.207, longitude: 128.5918, tagline: "산과 바다 사이, 속초의 지금" },
  { id: "daejeon", name: "대전", province: "대전광역시", latitude: 36.3504, longitude: 127.3845, tagline: "우리 동네부터 둘러보는 대전" },
  { id: "sejong", name: "세종", province: "세종특별자치시", latitude: 36.4801, longitude: 127.289, tagline: "가볍게 나서는 세종의 하루" },
  { id: "cheongju", name: "청주", province: "충청북도", latitude: 36.6424, longitude: 127.489, tagline: "익숙한 곳의 새로운 모습" },
  { id: "daegu", name: "대구", province: "대구광역시", latitude: 35.8714, longitude: 128.6014, tagline: "골목에서 만나는 대구의 지금" },
  { id: "busan", name: "부산", province: "부산광역시", latitude: 35.1796, longitude: 129.0756, tagline: "바다 곁의 일상, 부산의 지금" },
  { id: "ulsan", name: "울산", province: "울산광역시", latitude: 35.5396, longitude: 129.3115, tagline: "강과 바다 사이, 우리 동네의 지금" },
  { id: "gyeongju", name: "경주", province: "경상북도", latitude: 35.8562, longitude: 129.2247, tagline: "오래된 도시의 새로운 하루" },
  { id: "pohang", name: "포항", province: "경상북도", latitude: 36.019, longitude: 129.3435, tagline: "동해를 따라 만나는 포항" },
  { id: "changwon", name: "창원", province: "경상남도", latitude: 35.2286, longitude: 128.6811, tagline: "가까운 곳부터, 창원의 지금" },
  { id: "yangsan", name: "양산", province: "경상남도", latitude: 35.335, longitude: 129.0372, tagline: "일상 곁에서 찾는 양산의 하루" },
  { id: "tongyeong", name: "통영", province: "경상남도", latitude: 34.8544, longitude: 128.4331, tagline: "항구와 골목 사이, 통영의 지금" },
  { id: "geoje", name: "거제", province: "경상남도", latitude: 34.8806, longitude: 128.6211, tagline: "섬에서 만나는 오늘의 풍경" },
  { id: "jeonju", name: "전주", province: "전북특별자치도", latitude: 35.8242, longitude: 127.148, tagline: "걷고 머무르는 전주의 하루" },
  { id: "gwangju", name: "광주", province: "광주광역시", latitude: 35.1595, longitude: 126.8526, tagline: "동네를 새롭게 만나는 광주" },
  { id: "jeju", name: "제주시", province: "제주특별자치도", latitude: 33.4996, longitude: 126.5312, tagline: "섬의 북쪽에서 시작하는 오늘" },
  { id: "seogwipo", name: "서귀포", province: "제주특별자치도", latitude: 33.2541, longitude: 126.56, tagline: "제주 남쪽, 서귀포의 지금" },
];

export const DEFAULT_REGION_ID = "ulsan";

export function isSupportedRegionId(id: string): boolean {
  return REGIONS.some((region) => region.id === id);
}

export function getRegion(id: string | null | undefined): Region {
  return REGIONS.find((region) => region.id === id) ?? REGIONS.find((region) => region.id === DEFAULT_REGION_ID)!;
}

export function findNearestRegion(latitude: number, longitude: number): Region | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 33 || latitude > 39 || longitude < 124 || longitude > 132) return null;
  const radians = (value: number) => value * Math.PI / 180;
  const distances = REGIONS.map((region) => {
    const latDiff = radians(region.latitude - latitude);
    const lonDiff = radians(region.longitude - longitude);
    const a = Math.sin(latDiff / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(region.latitude)) * Math.sin(lonDiff / 2) ** 2;
    return { region, km: 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) };
  }).sort((a, b) => a.km - b.km);
  return distances[0].km <= 100 ? distances[0].region : null;
}
