import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getCommunityReports } from "@/features/local-live/community";
import { getGuidePlaces } from "@/features/local-live/guides";
import { parseLocalLiveQuery } from "@/features/local-live/query";
import { getRegion } from "@/features/local-live/regions";
import { getAirQuality, getPlaces, getWeather } from "@/features/local-live/server";
import type { RegionSnapshot } from "@/features/local-live/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = parseLocalLiveQuery(new URL(request.url));
    assertRateLimit({ key: rateLimitKey(request, "local-live"), limit: 40, windowMs: 60_000 });
    const region = getRegion(query.region);
    const [weatherResult, places, airQuality, reports] = await Promise.all([
      getWeather(region),
      getPlaces(region, query.category, query.q),
      getAirQuality(region),
      getCommunityReports(region),
    ]);
    const snapshot: RegionSnapshot = {
      region,
      generatedAt: new Date().toISOString(),
      refreshAfterSeconds: 180,
      ...weatherResult,
      places,
      airQuality,
      reports,
      guidePlaces: getGuidePlaces(region.id, query.category, query.q),
    };
    return NextResponse.json({ success: true, data: snapshot }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = fail(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
