export type DataStatus = "fresh" | "stale" | "unavailable" | "not_configured" | "unsupported";
export type DataKind = "observation" | "forecast" | "directory" | "community";

export type SourceInfo = {
  name: string;
  url: string;
  kind: DataKind;
};

export type DataResult<T> = {
  status: DataStatus;
  data: T | null;
  source: SourceInfo;
  observedAt: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  message: string;
};

export type Region = {
  id: string;
  name: string;
  province: string;
  latitude: number;
  longitude: number;
  tagline: string;
};

export type PlaceCategory = "all" | "attraction" | "restaurant" | "cafe" | "parking" | "family";

export type LocalPlace = {
  id: string;
  name: string;
  category: Exclude<PlaceCategory, "all">;
  categoryLabel: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  sourceName: string;
  sourceUrl: string;
  mapUrl: string;
};

export type CurrentWeather = {
  temperatureC: number | null;
  humidityPercent: number | null;
  windSpeedMs: number | null;
  precipitationMm: number | null;
  condition: string;
};

export type ForecastHour = {
  at: string;
  temperatureC: number | null;
  condition: string;
  precipitation: string | null;
};

export type AirQuality = {
  stationName: string;
  pm10: number | null;
  pm25: number | null;
  pm10Grade: string | null;
  pm25Grade: string | null;
};

export type CommunityReport = {
  id: string;
  placeId: string;
  placeName: string;
  caption: string;
  crowd: string;
  parking: string;
  createdAt: string;
  locationVerified: boolean;
};

export type RegionSnapshot = {
  region: Region;
  generatedAt: string;
  refreshAfterSeconds: number;
  weather: DataResult<CurrentWeather>;
  forecast: DataResult<ForecastHour[]>;
  airQuality: DataResult<AirQuality>;
  places: DataResult<LocalPlace[]>;
  guidePlaces: LocalPlace[];
  reports: DataResult<CommunityReport[]>;
};
