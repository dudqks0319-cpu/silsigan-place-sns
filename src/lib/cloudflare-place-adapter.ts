import type { Place, PlaceLaunchStage, RegionId, ReportCategory } from "./domain";

export type WorkerPlace = {
  id: string;
  name: string;
  address?: string;
  categoryId: string;
  areaId: string;
  regionId: string;
  latitude: number;
  longitude: number;
  score: number;
  status: "seed" | "beta" | "active" | "paused";
  coordinateStatus: "verified" | "TODO_COORDINATE_VERIFY" | "rejected";
};

export type CloudflarePlaceForApp = Place & {
  rankingScore: number;
};

const areaLabels: Record<string, string> = {
  "busan-suyeong": "부산 수영구",
  "busan-haeundae": "부산 해운대구",
  "busan-busanjin": "부산 부산진구",
  "busan-jung": "부산 중구",
  "ulsan-jung": "울산 중구",
  "ulsan-nam": "울산 남구",
  "ulsan-ulju": "울산 울주군",
  "gyeongju-hwango": "경북 경주시",
  "seoul-yeongdeungpo": "서울 영등포구",
};

export function workerPlacesToAppPlaces(places: WorkerPlace[]): CloudflarePlaceForApp[] {
  return places.map(workerPlaceToAppPlace);
}

export function workerPlaceToAppPlace(place: WorkerPlace): CloudflarePlaceForApp {
  if (place.coordinateStatus !== "verified" || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
    throw new Error("지도에 표시할 수 없는 Worker 장소가 포함됐습니다.");
  }

  const region = regionFromWorker(place.regionId);

  return {
    id: place.id,
    name: place.name,
    address: addressFromWorker(place),
    category: categoryFromWorker(place.categoryId),
    latitude: place.latitude,
    longitude: place.longitude,
    region,
    regionId: region,
    launchStage: launchStageFromWorker(place.status),
    rankingScore: Math.max(0, Math.round(place.score)),
  };
}

function categoryFromWorker(categoryId: string): ReportCategory {
  if (categoryId === "festival") return "festival";
  if (categoryId === "restaurant_cafe") return "restaurant_cafe";
  if (categoryId === "hospital") return "hospital";
  if (categoryId === "public_office") return "public_office";
  if (categoryId === "parking") return "parking";
  return "tourism";
}

function regionFromWorker(regionId: string): RegionId {
  if (regionId === "busan") return "busan";
  if (regionId === "ulsan") return "ulsan";
  if (regionId === "gyeongju") return "gyeongju";
  if (regionId === "daegu") return "daegu";
  if (regionId === "changwon") return "changwon";
  if (regionId === "gimhae") return "gimhae";
  if (regionId === "yangsan") return "yangsan";
  if (regionId === "pohang") return "pohang";
  if (regionId === "seoul") return "seoul";
  if (regionId === "jeju") return "jeju";
  if (regionId === "gangneung") return "gangneung";
  if (regionId === "jeonju") return "jeonju";
  if (regionId === "yeosu") return "yeosu";
  if (regionId === "sokcho") return "sokcho";

  throw new Error(`지원하지 않는 Worker 지역 ID입니다: ${regionId}`);
}

function launchStageFromWorker(status: WorkerPlace["status"]): PlaceLaunchStage {
  if (status === "seed" || status === "beta" || status === "active") {
    return status;
  }

  return "beta";
}

function addressFromWorker(place: WorkerPlace): string {
  if (place.address?.trim()) {
    return place.address.trim();
  }

  return `${areaLabels[place.areaId] ?? regionLabel(regionFromWorker(place.regionId))} · ${place.name}`;
}

function regionLabel(region: RegionId): string {
  if (region === "busan") return "부산";
  if (region === "ulsan") return "울산";
  if (region === "gyeongju") return "경주";
  if (region === "daegu") return "대구";
  if (region === "changwon") return "창원";
  if (region === "gimhae") return "김해";
  if (region === "yangsan") return "양산";
  if (region === "pohang") return "포항";
  if (region === "seoul") return "서울";
  if (region === "jeju") return "제주";
  if (region === "gangneung") return "강릉";
  if (region === "jeonju") return "전주";
  if (region === "yeosu") return "여수";
  return "속초";
}
