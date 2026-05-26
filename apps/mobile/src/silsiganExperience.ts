export type RegionName =
  | "서울"
  | "경기"
  | "인천"
  | "부산"
  | "대구"
  | "대전"
  | "광주"
  | "울산"
  | "강원"
  | "제주";

export type PlaceCategory = "관광지" | "축제" | "맛집" | "병원" | "관공서" | "주차";
export type CrowdLevel = "한산" | "보통" | "혼잡" | "매우 혼잡";
export type ParkingState = "여유" | "보통" | "부족" | "만차" | "확인 필요";
export type SignalTone = "good" | "watch" | "busy";

export type NationwidePlace = {
  id: string;
  name: string;
  region: RegionName;
  category: PlaceCategory;
  area: string;
  signal: string;
  signalTone: SignalTone;
  crowd: CrowdLevel;
  parking: ParkingState;
  wait: string;
  updatedAt: string;
  summary: string;
};

export type ReportSnapshot = {
  placeId: string;
  verified: boolean;
  hasPhoto: boolean;
  minutesAgo: number;
};

export type RecentReport = ReportSnapshot & {
  id: string;
  placeName: string;
  headline: string;
  stateLine: string;
};

export type QuestionControlShape = {
  includesPhotoRequestType: boolean;
  includesSeparatePhotoCheckbox: boolean;
};

export const serviceScope = {
  label: "전국 실시간",
  shortCopy: "전국 주요 장소의 혼잡, 줄, 주차, 현장 사진을 출발 전 바로 확인하세요.",
  regions: ["서울", "경기", "인천", "부산", "대구", "대전", "광주", "울산", "강원", "제주"] satisfies RegionName[],
} as const;

export const nationwidePlaces: NationwidePlace[] = [
  {
    id: "seoul-gwanghwamun",
    name: "광화문 광장",
    region: "서울",
    category: "관광지",
    area: "서울 종로",
    signal: "걷기 좋음",
    signalTone: "good",
    crowd: "보통",
    parking: "부족",
    wait: "줄 짧음",
    updatedAt: "4분 전",
    summary: "광장 쪽은 여유 있지만 주변 주차장은 빠르게 차고 있어요.",
  },
  {
    id: "gyeonggi-everland",
    name: "에버랜드 정문",
    region: "경기",
    category: "축제",
    area: "경기 용인",
    signal: "대기 확인",
    signalTone: "watch",
    crowd: "혼잡",
    parking: "보통",
    wait: "입장 대기 보통",
    updatedAt: "9분 전",
    summary: "정문 입장 대기는 움직이고 있지만 인기 구역은 확인이 필요해요.",
  },
  {
    id: "incheon-airport",
    name: "인천공항 T1",
    region: "인천",
    category: "주차",
    area: "인천 중구",
    signal: "주차 확인",
    signalTone: "watch",
    crowd: "보통",
    parking: "부족",
    wait: "체크인 보통",
    updatedAt: "11분 전",
    summary: "단기 주차장은 여유가 줄고 있어 출발 전에 한 번 더 확인하세요.",
  },
  {
    id: "busan-gwangalli",
    name: "광안리 해수욕장",
    region: "부산",
    category: "관광지",
    area: "부산 수영",
    signal: "혼잡 주의",
    signalTone: "busy",
    crowd: "매우 혼잡",
    parking: "만차",
    wait: "식당 대기 김",
    updatedAt: "7분 전",
    summary: "해변 산책로와 주변 식당 대기가 함께 늘고 있어요.",
  },
  {
    id: "daegu-dongseongro",
    name: "동성로",
    region: "대구",
    category: "맛집",
    area: "대구 중구",
    signal: "식사 가능",
    signalTone: "good",
    crowd: "보통",
    parking: "부족",
    wait: "웨이팅 짧음",
    updatedAt: "13분 전",
    summary: "메인 골목은 활기 있지만 식당 대기는 아직 짧아요.",
  },
  {
    id: "daejeon-cityhall",
    name: "대전시청 민원실",
    region: "대전",
    category: "관공서",
    area: "대전 서구",
    signal: "민원 가능",
    signalTone: "good",
    crowd: "한산",
    parking: "보통",
    wait: "대기 짧음",
    updatedAt: "18분 전",
    summary: "민원 창구 대기는 짧고 주차장은 지상보다 지하가 낫습니다.",
  },
  {
    id: "gwangju-hospital",
    name: "광주 응급의료센터",
    region: "광주",
    category: "병원",
    area: "광주 동구",
    signal: "대기 확인",
    signalTone: "watch",
    crowd: "혼잡",
    parking: "부족",
    wait: "접수 대기 김",
    updatedAt: "21분 전",
    summary: "접수 대기는 길지만 개인정보가 보이는 사진 제보는 제한됩니다.",
  },
  {
    id: "ulsan-taehwagang",
    name: "태화강 국가정원",
    region: "울산",
    category: "관광지",
    area: "울산 중구",
    signal: "산책 좋음",
    signalTone: "good",
    crowd: "보통",
    parking: "보통",
    wait: "줄 없음",
    updatedAt: "16분 전",
    summary: "강변은 여유 있고 주차장은 입구보다 안쪽이 낫습니다.",
  },
  {
    id: "gangwon-sokcho",
    name: "속초 중앙시장",
    region: "강원",
    category: "맛집",
    area: "강원 속초",
    signal: "웨이팅 확인",
    signalTone: "watch",
    crowd: "혼잡",
    parking: "부족",
    wait: "먹거리 줄 보통",
    updatedAt: "12분 전",
    summary: "먹거리 골목은 붐비지만 회전은 빠른 편이에요.",
  },
  {
    id: "jeju-airport",
    name: "제주공항 렌터카 셔틀",
    region: "제주",
    category: "주차",
    area: "제주 제주시",
    signal: "셔틀 확인",
    signalTone: "busy",
    crowd: "혼잡",
    parking: "확인 필요",
    wait: "셔틀 대기 김",
    updatedAt: "8분 전",
    summary: "렌터카 셔틀 대기가 길어 이동 시간을 여유 있게 잡아야 해요.",
  },
];

export const recentReports: RecentReport[] = [
  {
    id: "report-jeju-shuttle",
    placeId: "jeju-airport",
    placeName: "제주공항 렌터카 셔틀",
    headline: "셔틀 줄이 길어요",
    stateLine: "현장 인증 · 사진 없음 · 8분 전",
    verified: true,
    hasPhoto: false,
    minutesAgo: 8,
  },
  {
    id: "report-busan-parking",
    placeId: "busan-gwangalli",
    placeName: "광안리 해수욕장",
    headline: "공영주차장 만차에 가까워요",
    stateLine: "현장 인증 · 사진 있음 · 7분 전",
    verified: true,
    hasPhoto: true,
    minutesAgo: 7,
  },
  {
    id: "report-seoul-walk",
    placeId: "seoul-gwanghwamun",
    placeName: "광화문 광장",
    headline: "광장 산책은 괜찮아요",
    stateLine: "인증 없음 · 사진 있음 · 2분 전",
    verified: false,
    hasPhoto: true,
    minutesAgo: 2,
  },
];

export const quickQuestionExamples = [
  "지금 주차 가능해요?",
  "줄 얼마나 길어요?",
  "사람 너무 많나요?",
  "현장 사진 가능할까요?",
  "대기 얼마나 걸려요?",
];

export const questionTypeOptions = ["혼잡도", "줄", "주차", "날씨", "사진 요청", "기타"] as const;

export function getHomePriority(reports: ReportSnapshot[]): string[] {
  const hasLiveEvidence = reports.some((report) => report.verified || report.hasPhoto || report.minutesAgo <= 10);

  return hasLiveEvidence
    ? ["search", "live-summary", "quick-actions", "recent-reports", "nationwide-regions", "explain"]
    : ["search", "quick-actions", "nationwide-regions", "explain", "recent-reports"];
}

export function getQuestionControls(): QuestionControlShape {
  return {
    includesPhotoRequestType: true,
    includesSeparatePhotoCheckbox: false,
  };
}

export function getSignalColor(tone: SignalTone): string {
  if (tone === "good") {
    return "#0f766e";
  }

  if (tone === "watch") {
    return "#b45309";
  }

  return "#b91c1c";
}
