import type { KoreaSidoId } from "./regions.ts";

export type TourismCctvEntry = {
  id: string;
  regionId: KoreaSidoId;
  regionName: string;
  placeName: string;
  locality: string;
  providerName: string;
  officialUrl: string;
  lastVerifiedAt: string;
  integrationMode: "external_link";
  legalReviewStatus: "external_link_only";
  playbackVerification: "single_camera_page";
  rightsNote: string;
  canEmbed: false;
  canAnalyze: false;
};

const POHANG_CCTV_ORIGIN = "https://safecctv.pohang.go.kr";
const JEJU_CCTV_ORIGIN = "https://www.jeju.go.kr";
const POHANG_VERIFIED_AT = "2026-08-18";
const HALLA_VERIFIED_AT = "2026-08-19";
const POHANG_RIGHTS_NOTE =
  "포항시 공식 단독 CCTV 페이지를 새 창에서만 엽니다. 영상 임베드·프록시·저장·분석·재송출은 하지 않습니다.";
const HALLA_RIGHTS_NOTE =
  "제주특별자치도 공식 한라산 단독 CCTV 페이지를 새 창에서만 엽니다. 영상 임베드·프록시·저장·분석·재송출은 하지 않습니다.";

function verifiedCamera(
  id: string,
  placeName: string,
  locality: string,
  cameraNumber: string,
): TourismCctvEntry {
  return {
    id,
    regionId: "gyeongbuk",
    regionName: "경북",
    placeName,
    locality,
    providerName: "포항시 재난안전 CCTV",
    officialUrl: `${POHANG_CCTV_ORIGIN}/${cameraNumber}`,
    lastVerifiedAt: POHANG_VERIFIED_AT,
    integrationMode: "external_link",
    legalReviewStatus: "external_link_only",
    playbackVerification: "single_camera_page",
    rightsNote: POHANG_RIGHTS_NOTE,
    canEmbed: false,
    canAnalyze: false,
  };
}

function verifiedHallaCamera(
  id: string,
  placeName: string,
  cameraNumber: string,
): TourismCctvEntry {
  return {
    id,
    regionId: "jeju",
    regionName: "제주",
    placeName,
    locality: "한라산",
    providerName: "제주특별자치도 한라산 CCTV",
    officialUrl: `${JEJU_CCTV_ORIGIN}/tool/halla/cctv_0${cameraNumber}.html`,
    lastVerifiedAt: HALLA_VERIFIED_AT,
    integrationMode: "external_link",
    legalReviewStatus: "external_link_only",
    playbackVerification: "single_camera_page",
    rightsNote: HALLA_RIGHTS_NOTE,
    canEmbed: false,
    canAnalyze: false,
  };
}

export const TOURISM_CCTV_CATALOG: readonly TourismCctvEntry[] = [
  verifiedCamera("pohang-yeongildae", "영일대해수욕장", "포항시 북구", "100038"),
  verifiedCamera("pohang-guryongpo", "구룡포해수욕장", "포항시 남구", "100036"),
  verifiedCamera("pohang-homigot", "호미곶해맞이광장", "포항시 남구", "100096"),
  verifiedCamera("pohang-yonghan", "용한리해수욕장", "포항시 북구", "100123"),
  verifiedHallaCamera("halla-baengnokdam", "한라산 백록담", "1"),
  verifiedHallaCamera("halla-wanggwanneung", "한라산 왕관릉", "2"),
  verifiedHallaCamera("halla-witseoreum", "한라산 윗세오름", "3"),
  verifiedHallaCamera("halla-eoseungsaengak", "한라산 어승생악", "4"),
];

const ALLOWED_TOURISM_CCTV_URLS = new Set(
  TOURISM_CCTV_CATALOG.map((entry) => entry.officialUrl),
);

export function isAllowedTourismCctvUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hasAllowedShape =
      (url.origin === POHANG_CCTV_ORIGIN && /^\/\d{6}$/.test(url.pathname)) ||
      (url.origin === JEJU_CCTV_ORIGIN &&
        /^\/tool\/halla\/cctv_0[1-4]\.html$/.test(url.pathname));

    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      hasAllowedShape &&
      url.search === "" &&
      url.hash === "" &&
      ALLOWED_TOURISM_CCTV_URLS.has(url.href)
    );
  } catch {
    return false;
  }
}

export function tourismCctvForRegion(
  regionId: KoreaSidoId,
): readonly TourismCctvEntry[] {
  return TOURISM_CCTV_CATALOG.filter((entry) => entry.regionId === regionId);
}
