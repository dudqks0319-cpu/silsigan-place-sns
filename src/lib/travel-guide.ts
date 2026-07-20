export type TravelGuideDataMode = "live" | "sample" | "directory" | "unavailable";

export type TravelGuideStatus =
  | "likely_good"
  | "check_before_visit"
  | "likely_crowded"
  | "insufficient";

export type OfficialTourismPlace = {
  contentId: string;
  name: string;
  address: string | null;
  sourceName: "한국관광공사 TourAPI";
  attributionText: "한국관광공사";
  verifiedAt: string;
};

export type GroundedTravelGuideInput = {
  dataMode: TravelGuideDataMode;
  status: TravelGuideStatus;
  signalCount: number;
  missingRequiredDimensions: readonly string[];
  conflictingDimensions: readonly string[];
  alternativeCount: number;
  officialTourismPlace: OfficialTourismPlace | null;
};

export type GroundedTravelGuide = {
  decision: "go_now" | "wait" | "alternatives" | "insufficient";
  title: "지금 가기" | "조금 기다리기" | "근처 대안 보기" | "판단 보류";
  summary: string;
  ctaLabel: string;
  sourceLine: string;
  tourApiGrounded: boolean;
  hashtags: readonly ["실시간", "여행가이드", "연관관광지추천", "카드뉴스형답변"];
};

const contestHashtags = ["실시간", "여행가이드", "연관관광지추천", "카드뉴스형답변"] as const;

export function buildGroundedTravelGuide(input: GroundedTravelGuideInput): GroundedTravelGuide {
  const signalCount = boundedCount(input.signalCount);
  const alternativeCount = boundedCount(input.alternativeCount);
  const tourApiGrounded = Boolean(input.officialTourismPlace);
  const sourceLine = tourApiGrounded
    ? `한국관광공사 TourAPI 관광지 정보 · 최신 근거 ${signalCount}개`
    : `최신 근거 ${signalCount}개 · TourAPI 관광지 매핑 확인 필요`;
  const shared = { sourceLine, tourApiGrounded, hashtags: contestHashtags };

  if (input.dataMode !== "live") {
    return {
      ...shared,
      decision: "insufficient",
      title: "판단 보류",
      summary: unavailableSummary(input.dataMode),
      ctaLabel: alternativeCount > 0 ? `근처 ${alternativeCount}곳 보기` : "지도에서 대안 찾기",
    };
  }

  if (signalCount === 0) {
    return {
      ...shared,
      decision: "insufficient",
      title: "판단 보류",
      summary: "현재 유효한 현장 근거가 없어 방문 시점을 추천하지 않습니다.",
      ctaLabel: alternativeCount > 0 ? `근처 ${alternativeCount}곳 보기` : "지도에서 대안 찾기",
    };
  }

  if (input.conflictingDimensions.length > 0) {
    return {
      ...shared,
      decision: "wait",
      title: "조금 기다리기",
      summary: "출처별 현장 판단이 엇갈립니다. 최신 사진이나 새 관측이 들어온 뒤 다시 확인해 주세요.",
      ctaLabel: "최신 근거 확인",
    };
  }

  if (input.missingRequiredDimensions.length > 0) {
    return {
      ...shared,
      decision: "wait",
      title: "조금 기다리기",
      summary: "필수 여행 변수의 최신 정보가 부족합니다. 새 관측이 들어올 때까지 판단을 보류합니다.",
      ctaLabel: "최신 근거 확인",
    };
  }

  if (input.status === "likely_crowded" && alternativeCount > 0) {
    return {
      ...shared,
      decision: "alternatives",
      title: "근처 대안 보기",
      summary: "현재 혼잡 또는 이용 제약 가능성이 높습니다. 같은 지역의 다른 장소를 먼저 비교해 보세요.",
      ctaLabel: `대안 ${alternativeCount}곳 확인`,
    };
  }

  if (input.status === "likely_crowded" || input.status === "check_before_visit") {
    return {
      ...shared,
      decision: "wait",
      title: "조금 기다리기",
      summary: input.status === "likely_crowded"
        ? "현재 혼잡 가능성이 높고 확인된 대안이 없습니다. 잠시 뒤 최신 상황을 다시 확인해 주세요."
        : "변수가 바뀔 수 있어 출발 직전 최신 사진과 관측을 한 번 더 확인해 주세요.",
      ctaLabel: "최신 근거 확인",
    };
  }

  if (input.status === "likely_good") {
    return {
      ...shared,
      decision: "go_now",
      title: "지금 가기",
      summary: "현재 확인된 여행 변수는 방문에 유리합니다. 출발 전 관측시각과 현장 사진을 마지막으로 확인하세요.",
      ctaLabel: "현장 사진 확인",
    };
  }

  return {
    ...shared,
    decision: "insufficient",
    title: "판단 보류",
    summary: "현재 근거만으로 방문 시점을 추천하기 어렵습니다.",
    ctaLabel: alternativeCount > 0 ? `근처 ${alternativeCount}곳 보기` : "지도에서 대안 찾기",
  };
}

function boundedCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function unavailableSummary(dataMode: Exclude<TravelGuideDataMode, "live">): string {
  if (dataMode === "sample") {
    return "체험용 샘플은 실제 여행 판단에 사용할 수 없습니다.";
  }
  if (dataMode === "directory") {
    return "API 보호 중에는 검증된 장소 위치만 보여주며 현재 상태를 추정하지 않습니다.";
  }
  return "현재 여행 변수 데이터를 불러올 수 없어 방문 판단을 보류합니다.";
}
