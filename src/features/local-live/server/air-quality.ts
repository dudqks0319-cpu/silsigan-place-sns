import { z } from "zod";
import type { AirQuality, DataResult, Region, SourceInfo } from "../types.ts";
import { credentialId, freshness, missing, numeric, plusMinutes, serviceKey, unavailable, type ProviderRuntime } from "./runtime.ts";
import { kmaTimestamp } from "./weather.ts";

const SOURCE: SourceInfo = { name: "에어코리아", url: "https://www.data.go.kr/data/15073861/openapi.do", kind: "observation" };
const itemSchema = z.object({
  dataTime: z.string().max(25),
  stationName: z.string().optional(),
  pm10Value: z.string().nullable().optional(), pm25Value: z.string().nullable().optional(),
  pm10Grade1h: z.string().nullable().optional(), pm25Grade1h: z.string().nullable().optional(),
  pm10Flag: z.string().nullable().optional(), pm25Flag: z.string().nullable().optional(),
});
const responseSchema = z.object({ response: z.object({
  header: z.object({ resultCode: z.literal("00") }), body: z.object({ items: z.array(itemSchema).max(100) }),
}) });

export function airTimestamp(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = `${year}${month}${day}`;
  if (hour === "24" && minute === "00") {
    const midnight = kmaTimestamp(date, "0000");
    return midnight ? plusMinutes(midnight, 24 * 60) : null;
  }
  return kmaTimestamp(date, `${hour}${minute}`);
}

function grade(value: string | null | undefined): string | null {
  return ({ "1": "좋음", "2": "보통", "3": "나쁨", "4": "매우 나쁨" } as Record<string, string>)[value ?? ""] ?? null;
}

export function createAirQualityProvider(runtime: ProviderRuntime) {
  return async (region: Region): Promise<DataResult<AirQuality>> => {
    const key = runtime.env.AIRKOREA_SERVICE_KEY?.trim() || runtime.env.KOREA_DATA_API_KEY?.trim();
    if (!key) return missing(SOURCE, "대기질 정보 연결을 준비하고 있어요.");
    let station: string | undefined;
    try {
      const map = z.record(z.string().trim().min(1).max(50)).parse(JSON.parse(runtime.env.AIRKOREA_STATIONS || "{}"));
      station = map[region.id];
    } catch {
      return unavailable(SOURCE, runtime.now(), "지역 측정소 연결 정보를 확인하고 있어요.");
    }
    if (!station) return { ...missing<AirQuality>(SOURCE, "이 지역의 대기질 측정소가 아직 연결되지 않았어요."), status: "unsupported" };
    const stationName = station;
    return runtime.cached(`air:${region.id}:${stationName}:${credentialId(key)}`, 10 * 60_000, async () => {
      try {
        const url = new URL("https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty");
        url.search = new URLSearchParams({ serviceKey: serviceKey(key), returnType: "json", pageNo: "1", numOfRows: "24", stationName, dataTerm: "DAILY", ver: "1.3" }).toString();
        const payload = responseSchema.parse(await runtime.json(url));
        const now = runtime.now();
        const items = payload.response.body.items.map((item) => ({ item, observedAt: airTimestamp(item.dataTime) }))
          .filter((entry): entry is { item: z.infer<typeof itemSchema>; observedAt: string } => Boolean(entry.observedAt) && (!entry.item.stationName || entry.item.stationName === stationName) && Date.parse(entry.observedAt!) <= now.getTime() + 60_000)
          .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
        const latest = items[0];
        if (!latest) return unavailable<AirQuality>(SOURCE, now, "측정소의 최신 측정값을 확인하지 못했어요.");
        const pm10 = latest.item.pm10Flag?.trim() ? null : numeric(latest.item.pm10Value, 0, 5000);
        const pm25 = latest.item.pm25Flag?.trim() ? null : numeric(latest.item.pm25Value, 0, 5000);
        const status = freshness(latest.observedAt, now, 120);
        if ((pm10 === null && pm25 === null) || status === "unavailable") return unavailable<AirQuality>(SOURCE, now, "측정소 점검 또는 측정 지연으로 대기질을 확인할 수 없어요.");
        return {
          status, data: { stationName, pm10, pm25, pm10Grade: pm10 === null ? null : grade(latest.item.pm10Grade1h), pm25Grade: pm25 === null ? null : grade(latest.item.pm25Grade1h) },
          source: SOURCE, observedAt: latest.observedAt, fetchedAt: now.toISOString(), expiresAt: plusMinutes(latest.observedAt, 120),
          message: status === "stale" ? `${stationName} 측정소의 이전 관측값입니다. 측정이 지연되고 있어요.` : `${stationName} 측정소 기준의 1시간 관측값입니다. 내 위치의 실측값은 아닙니다.`,
        };
      } catch {
        return unavailable<AirQuality>(SOURCE, runtime.now(), "대기질 정보를 일시적으로 불러오지 못했어요.");
      }
    });
  };
}
