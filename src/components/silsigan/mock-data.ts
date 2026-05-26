import {
  CircleUserRound,
  HelpCircle,
  Home,
  Map,
  ShieldCheck,
  Siren
} from "lucide-react";
import type { FieldOption, NavItem, Place } from "./types";

export const navItems: NavItem[] = [
  { id: "home", label: "홈", icon: Home },
  { id: "map", label: "지도", icon: Map },
  { id: "place", label: "상세", icon: ShieldCheck },
  { id: "report", label: "제보", icon: Siren },
  { id: "question", label: "질문", icon: HelpCircle },
  { id: "my", label: "마이", icon: CircleUserRound }
];

export const places: Place[] = [
  {
    id: "ulsan-grand-park",
    name: "울산대공원 장미원",
    category: "tour",
    address: "울산 남구 대공원로 94",
    distance: "1.2km",
    status: "보통",
    summary: "입구 줄은 짧고 산책로는 여유 있습니다.",
    crowd: "normal",
    line: "짧음",
    parking: "부족",
    weather: "바람셈",
    updatedAt: "4분 전",
    reports: 18,
    questions: 7,
    coordinates: { x: 28, y: 42 },
    photos: ["장미원 입구", "주차장 입구", "중앙 산책로"]
  },
  {
    id: "busan-fireworks",
    name: "광안리 행사장",
    category: "event",
    address: "부산 수영구 광안해변로",
    distance: "38km",
    status: "매우 혼잡",
    summary: "해변 앞 보행 통로가 막히기 시작했습니다.",
    crowd: "crowded",
    line: "김",
    parking: "만차",
    weather: "좋음",
    updatedAt: "2분 전",
    reports: 42,
    questions: 19,
    coordinates: { x: 66, y: 34 },
    photos: ["해변 보행로", "공영주차장", "무대 앞"]
  },
  {
    id: "gyeongju-cafe",
    name: "황리단길 카페거리",
    category: "food",
    address: "경북 경주시 포석로",
    distance: "29km",
    status: "혼잡",
    summary: "인기 카페 대기 20분, 골목은 이동 가능합니다.",
    crowd: "busy",
    line: "보통",
    parking: "부족",
    weather: "좋음",
    updatedAt: "8분 전",
    reports: 25,
    questions: 11,
    coordinates: { x: 52, y: 62 },
    photos: ["카페 대기줄", "골목 입구", "공영주차장"]
  },
  {
    id: "ulsan-hospital",
    name: "울산 중앙응급의료센터",
    category: "hospital",
    address: "울산 중구 응급의료로",
    distance: "2.8km",
    status: "혼잡",
    summary: "대기석은 붐비지만 접수 동선은 유지 중입니다.",
    crowd: "busy",
    line: "보통",
    parking: "가능",
    weather: "비옴",
    updatedAt: "6분 전",
    reports: 9,
    questions: 5,
    coordinates: { x: 36, y: 74 },
    photos: ["주차장 진입로", "외부 안내판", "건물 외관"]
  }
];

export const crowdOptions: FieldOption[] = [
  { label: "여유", value: "safe" },
  { label: "보통", value: "normal" },
  { label: "혼잡", value: "busy" },
  { label: "매우 혼잡", value: "crowded" }
];

export const lineOptions: FieldOption[] = [
  { label: "없음", value: "none" },
  { label: "짧음", value: "short" },
  { label: "보통", value: "medium" },
  { label: "김", value: "long" }
];

export const parkingOptions: FieldOption[] = [
  { label: "가능", value: "available" },
  { label: "부족", value: "limited" },
  { label: "만차", value: "full" },
  { label: "모름", value: "unknown" }
];

export const weatherOptions: FieldOption[] = [
  { label: "좋음", value: "clear" },
  { label: "비옴", value: "rain" },
  { label: "바람셈", value: "wind" },
  { label: "더움", value: "hot" },
  { label: "추움", value: "cold" }
];

export const questionTypes: FieldOption[] = [
  { label: "혼잡도", value: "crowd" },
  { label: "줄", value: "line" },
  { label: "주차", value: "parking" },
  { label: "날씨", value: "weather" },
  { label: "사진 요청", value: "photo" },
  { label: "기타", value: "etc" }
];
