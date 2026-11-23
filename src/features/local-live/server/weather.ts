import { z } from "zod";
import type { CurrentWeather, DataResult, ForecastHour, Region, SourceInfo } from "../types.ts";
import { credentialId, freshness, missing, numeric, plusMinutes, serviceKey, unavailable, type ProviderRuntime } from "./runtime.ts";

const WEATHER_SOURCE: SourceInfo = { name: "기상청 초단기실황", url: "https://www.data.go.kr/data/15084084/openapi.do", kind: "observation" };
const FORECAST_SOURCE: SourceInfo = { ...WEATHER_SOURCE, name: "기상청 초단기예보", kind: "forecast" };
const KST = 9 * 60 * 60_000;
const itemSchema = z.object({
  baseDate: z.string().regex(/^\d{8}$/), baseTime: z.string().regex(/^\d{4}$/),
  category: z.string().max(10), nx: z.number().optional(), ny: z.number().optional(),
  obsrValue: z.union([z.string(), z.number()]).optional(),
  fcstDate: z.string().regex(/^\d{8}$/).optional(), fcstTime: z.string().regex(/^\d{4}$/).optional(),
  fcstValue: z.union([z.string(), z.number()]).optional(),
});
const responseSchema = z.object({ response: z.object({
  header: z.object({ resultCode: z.literal("00") }),
  body: z.object({ items: z.object({ item: z.array(itemSchema).max(1000) }) }),
}) });
const noDataSchema = z.object({ response: z.object({ header: z.object({ resultCode: z.literal("03") }) }) });
type KmaItem = z.infer<typeof itemSchema>;

/** Lambert conformal conic projection used by the KMA 5 km forecast grid. */
export function toKmaGrid(latitude: number, longitude: number): { nx: number; ny: number } {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 32 || latitude > 40 || longitude < 123 || longitude > 133) {
    throw new Error("Coordinates outside supported Korean region");
  }
  const radians = Math.PI / 180;
  const earth = 6371.00877 / 5;
  const slat1 = 30 * radians;
  const slat2 = 60 * radians;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(Math.tan(Math.PI / 4 + slat2 / 2) / Math.tan(Math.PI / 4 + slat1 / 2));
  const sf = Math.pow(Math.tan(Math.PI / 4 + slat1 / 2), sn) * Math.cos(slat1) / sn;
  const ro = earth * sf / Math.pow(Math.tan(Math.PI / 4 + 38 * radians / 2), sn);
  const ra = earth * sf / Math.pow(Math.tan(Math.PI / 4 + latitude * radians / 2), sn);
  const theta = (longitude - 126) * radians * sn;
  return { nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5) };
}

/** Uses hourly data.go.kr products; allow 10 min for observations and 15 min after HH:30 for forecasts.
 * Source: KMA API 활용가이드 (260623), base_time tables, linked from
 * https://apihub.kma.go.kr/apiList.do?seqApi=10 (section 4).
 */
export function kmaBase(now: Date, type: "observation" | "forecast") {
  const shifted = new Date(now.getTime() + KST - (type === "observation" ? 10 : 45) * 60_000);
  const date = shifted.toISOString().slice(0, 10).replaceAll("-", "");
  const hour = shifted.getUTCHours().toString().padStart(2, "0");
  return { date, time: `${hour}${type === "observation" ? "00" : "30"}` };
}

export function kmaTimestamp(date: string, time: string): string | null {
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  return new Date(local.getTime() - KST).toISOString();
}

function condition(precipitation: unknown, sky?: unknown): string {
  const wet: Record<string, string> = { "1": "비", "2": "비와 눈", "3": "눈", "4": "소나기", "5": "빗방울", "6": "빗방울과 눈날림", "7": "눈날림" };
  if (wet[String(precipitation)]) return wet[String(precipitation)];
  if (String(precipitation) !== "0") return "상태 미확인";
  return ({ "1": "맑음", "3": "구름 많음", "4": "흐림" } as Record<string, string>)[String(sky)] ?? "강수 없음";
}

function latestGroup(items: KmaItem[], now: Date): { stamp: string; items: KmaItem[] } | null {
  const groups = new Map<string, KmaItem[]>();
  for (const item of items) {
    const stamp = kmaTimestamp(item.baseDate, item.baseTime);
    if (!stamp || Date.parse(stamp) > now.getTime() + 60_000) continue;
    groups.set(stamp, [...(groups.get(stamp) ?? []), item]);
  }
  const stamp = [...groups.keys()].sort().at(-1);
  return stamp ? { stamp, items: groups.get(stamp)! } : null;
}

function observation(items: KmaItem[], now: Date): DataResult<CurrentWeather> {
  const group = latestGroup(items, now);
  if (!group) return unavailable(WEATHER_SOURCE, now, "날씨 관측 시각을 확인하지 못했어요.");
  const values = new Map(group.items.map((item) => [item.category, item.obsrValue]));
  const data: CurrentWeather = {
    temperatureC: numeric(values.get("T1H"), -90, 65),
    humidityPercent: numeric(values.get("REH"), 0, 100),
    windSpeedMs: numeric(values.get("WSD"), 0, 150),
    precipitationMm: numeric(values.get("RN1"), 0, 1000),
    condition: condition(values.get("PTY")),
  };
  const status = freshness(group.stamp, now, 90);
  if (status === "unavailable" || [data.temperatureC, data.humidityPercent, data.windSpeedMs, data.precipitationMm].every((value) => value === null)) {
    return unavailable(WEATHER_SOURCE, now, "유효한 최신 관측값이 없어요.");
  }
  return { status, data, source: WEATHER_SOURCE, observedAt: group.stamp, fetchedAt: now.toISOString(), expiresAt: plusMinutes(group.stamp, 90),
    message: status === "stale" ? "관측이 지연되고 있어요. 이전 관측값입니다." : "선택한 지역 중심의 5km 격자 관측값입니다." };
}

function forecast(items: KmaItem[], now: Date): DataResult<ForecastHour[]> {
  const group = latestGroup(items, now);
  if (!group) return unavailable(FORECAST_SOURCE, now, "예보 발표 시각을 확인하지 못했어요.");
  const hours = new Map<string, Map<string, unknown>>();
  for (const item of group.items) {
    const at = item.fcstDate && item.fcstTime ? kmaTimestamp(item.fcstDate, item.fcstTime) : null;
    if (!at || Date.parse(at) < now.getTime() || Date.parse(at) > now.getTime() + 6 * 60 * 60_000) continue;
    const values = hours.get(at) ?? new Map<string, unknown>();
    values.set(item.category, item.fcstValue);
    hours.set(at, values);
  }
  const data = [...hours.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 6).map(([at, values]) => {
    const rawRain = values.get("RN1");
    const rain = numeric(rawRain, 0, 1000);
    return { at, temperatureC: numeric(values.get("T1H"), -90, 65), condition: condition(values.get("PTY"), values.get("SKY")),
      precipitation: rain !== null ? `${rain}mm` : typeof rawRain === "string" && /^(강수없음|1\.0mm 미만|[\d.]+~[\d.]+mm|[\d.]+mm 이상)$/.test(rawRain) ? rawRain : null };
  }).filter((hour) => hour.temperatureC !== null || hour.condition !== "상태 미확인" || hour.precipitation !== null);
  const status = freshness(group.stamp, now, 90);
  if (!data.length || status === "unavailable") return unavailable(FORECAST_SOURCE, now, "앞으로의 시간대별 예보가 아직 없어요.");
  return { status, data, source: FORECAST_SOURCE, observedAt: group.stamp, fetchedAt: now.toISOString(), expiresAt: plusMinutes(group.stamp, 90),
    message: status === "stale" ? "새 예보가 지연되어 이전 발표 예보를 표시합니다." : "발표 시각 기준의 예측입니다. 실제 날씨와 다를 수 있어요." };
}

async function kmaItems(runtime: ProviderRuntime, region: Region, key: string, type: "observation" | "forecast") {
  const requestedAt = runtime.now();
  const grid = toKmaGrid(region.latitude, region.longitude);
  for (let attempt = 0; attempt < 2; attempt++) {
    const base = kmaBase(new Date(requestedAt.getTime() - attempt * 60 * 60_000), type);
    const url = new URL(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${type === "observation" ? "getUltraSrtNcst" : "getUltraSrtFcst"}`);
    url.search = new URLSearchParams({ serviceKey: serviceKey(key), pageNo: "1", numOfRows: "1000", dataType: "JSON", base_date: base.date, base_time: base.time, nx: String(grid.nx), ny: String(grid.ny) }).toString();
    const payload = await runtime.json(url);
    // Publication can lag: only an explicit NO_DATA response permits one older
    // issuance request. Network, authentication and quota failures are not retried.
    if (attempt === 0 && noDataSchema.safeParse(payload).success) continue;
    const result = responseSchema.parse(payload);
    // Preserve the returned base timestamps; the older issuance may be stale.
    return result.response.body.items.item.filter((item) => (item.nx === undefined || item.nx === grid.nx) && (item.ny === undefined || item.ny === grid.ny));
  }
  return [];
}

export function createWeatherProvider(runtime: ProviderRuntime) {
  return async (region: Region) => {
    const key = runtime.env.KMA_SERVICE_KEY?.trim() || runtime.env.KOREA_DATA_API_KEY?.trim();
    if (!key) return { weather: missing<CurrentWeather>(WEATHER_SOURCE, "지역 날씨 연결을 준비하고 있어요."), forecast: missing<ForecastHour[]>(FORECAST_SOURCE, "시간대별 예보 연결을 준비하고 있어요.") };
    const grid = toKmaGrid(region.latitude, region.longitude);
    const id = `${grid.nx}:${grid.ny}:${credentialId(key)}`;
    const [weather, future] = await Promise.all([
      runtime.cached(`weather:${id}`, 5 * 60_000, async () => {
        try { return observation(await kmaItems(runtime, region, key, "observation"), runtime.now()); }
        catch { return unavailable<CurrentWeather>(WEATHER_SOURCE, runtime.now(), "날씨 정보를 일시적으로 불러오지 못했어요."); }
      }),
      runtime.cached(`forecast:${id}`, 10 * 60_000, async () => {
        try { return forecast(await kmaItems(runtime, region, key, "forecast"), runtime.now()); }
        catch { return unavailable<ForecastHour[]>(FORECAST_SOURCE, runtime.now(), "시간대별 예보를 일시적으로 불러오지 못했어요."); }
      }),
    ]);
    // A cached forecast may cross an hour boundary; keep its original provenance,
    // but do not keep already-passed hours in the upcoming forecast strip.
    const forecastData = future.data?.filter((hour) => Date.parse(hour.at) >= runtime.now().getTime()) ?? null;
    return {
      weather,
      forecast: future.data && !forecastData?.length
        ? unavailable<ForecastHour[]>(FORECAST_SOURCE, runtime.now(), "다음 시간대의 예보를 기다리고 있어요.")
        : { ...future, data: forecastData },
    };
  };
}
