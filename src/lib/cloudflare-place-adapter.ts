import type { Place, PlaceLaunchStage, RegionId, ReportCategory } from "./domain";
import { KOREA_SIDO_REGIONS, isKoreaPlaceRegionId } from "../../packages/contracts/src/index.ts";

export type WorkerPlace = {
  id: string;
  name: string;
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
  "ulsan-jung": "울산 중구",
  "ulsan-nam": "울산 남구",
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
  if (isKoreaPlaceRegionId(regionId)) return regionId;

  throw new Error(`지원하지 않는 Worker 지역 ID입니다: ${regionId}`);
}

function launchStageFromWorker(status: WorkerPlace["status"]): PlaceLaunchStage {
  if (status === "seed" || status === "beta" || status === "active") {
    return status;
  }

  return "beta";
}

function addressFromWorker(place: WorkerPlace): string {
  return `${areaLabels[place.areaId] ?? regionLabel(regionFromWorker(place.regionId))} · ${place.name}`;
}

function regionLabel(region: RegionId): string {
  const sido = KOREA_SIDO_REGIONS.find((item) => item.id === region);
  if (sido) return sido.name;

  const childLabels: Partial<Record<RegionId, string>> = {
    changwon: "창원",
    gangneung: "강릉",
    gimhae: "김해",
    gyeongju: "경주",
    pohang: "포항",
    sokcho: "속초",
    yangsan: "양산",
    yeosu: "여수",
    jeonju: "전주",
  };

  return childLabels[region] ?? region;
}
