import type { CrowdLevel, LineStatus, ParkingStatus, WeatherFeel } from "@/lib/domain";

export const crowdLabels: Record<CrowdLevel, string> = {
  quiet: "한산",
  normal: "보통",
  busy: "많음",
  packed: "매우 많음",
};

export const parkingLabels: Record<ParkingStatus, string> = {
  available: "여유",
  limited: "거의 없음",
  full: "만차",
  unknown: "정보 없음",
};

export const lineLabels: Record<LineStatus, string> = {
  none: "없음",
  short: "짧음",
  medium: "보통",
  long: "김",
};

export const weatherLabels: Record<WeatherFeel, string> = {
  good: "좋음",
  rainy: "비",
  windy: "바람",
  hot: "더움",
  cold: "추움",
};
