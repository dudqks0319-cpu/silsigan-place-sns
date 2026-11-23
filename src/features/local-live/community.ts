import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CommunityReport, DataResult, Region } from "./types.ts";

const REPORT_WINDOW_MS = 3 * 60 * 60 * 1000;
const source = { name: "이용자 현장 제보", url: "/", kind: "community" as const };
const placeSchema = z.object({ name: z.string().min(1).max(120), region: z.string().max(32) });
const reportSchema = z.object({
  id: z.string().min(1).max(80),
  place_id: z.string().min(1).max(80),
  caption: z.string().max(120).nullable(),
  crowd_level: z.enum(["quiet", "normal", "busy", "packed"]),
  parking_status: z.enum(["available", "limited", "full", "unknown"]),
  location_verified: z.boolean(),
  hidden_at: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  place: z.union([placeSchema, z.array(placeSchema).length(1)]),
});
const CROWD = { quiet: "한산하다는 제보", normal: "보통이라는 제보", busy: "붐빈다는 제보", packed: "매우 붐빈다는 제보" };
const PARKING = { available: "주차 여유 제보", limited: "주차 공간 적음 제보", full: "주차 만차 제보", unknown: "주차 미확인" };

export function normalizeCommunityReports(rows: unknown[], regionId: string, now: Date): CommunityReport[] {
  return rows.flatMap((row) => {
    const parsed = reportSchema.safeParse(row);
    if (!parsed.success) return [];
    const report = parsed.data;
    const place = Array.isArray(report.place) ? report.place[0] : report.place;
    const age = now.getTime() - Date.parse(report.created_at);
    if (report.hidden_at || place.region !== regionId || age < 0 || age >= REPORT_WINDOW_MS) return [];
    return [{
      id: report.id,
      placeId: report.place_id,
      placeName: place.name,
      caption: report.caption ?? "현장 상황이 공유됐어요.",
      crowd: CROWD[report.crowd_level],
      parking: PARKING[report.parking_status],
      createdAt: report.created_at,
      locationVerified: report.location_verified,
    }];
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20);
}

export async function getCommunityReports(region: Region): Promise<DataResult<CommunityReport[]>> {
  const base = { source, data: null, observedAt: null, fetchedAt: null, expiresAt: null };
  if (process.env.LOCAL_LIVE_COMMUNITY_ENABLED !== "true" || process.env.SILSIGAN_STORE_DRIVER !== "supabase") {
    return { ...base, status: "not_configured", message: "현장 소식은 준비 중이에요. 확인된 제보가 모이면 이곳에서 볼 수 있어요." };
  }
  // The existing database's region enum supports only these three regions.
  if (!["ulsan", "busan", "gyeongju"].includes(region.id)) {
    return { ...base, status: "unsupported", message: "이 지역의 현장 제보는 아직 연결되지 않았어요." };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ...base, status: "not_configured", message: "현장 소식을 연결하고 있어요." };
  const now = new Date();
  try {
    // Public read credentials deliberately retain RLS; this feed never needs a service role.
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.from("silsigan_posts")
      .select("id,place_id,caption,crowd_level,parking_status,location_verified,hidden_at,created_at,place:silsigan_places!inner(name,region)")
      .eq("place.region", region.id)
      .is("hidden_at", null)
      .gt("created_at", new Date(now.getTime() - REPORT_WINDOW_MS).toISOString())
      .lte("created_at", now.toISOString())
      .order("created_at", { ascending: false })
      .limit(20)
      .abortSignal(AbortSignal.timeout(5000));
    if (error || !Array.isArray(data)) throw new Error("community unavailable");
    const reports = normalizeCommunityReports(data, region.id, now);
    return {
      status: "fresh", data: reports, source,
      observedAt: reports[0]?.createdAt ?? null,
      fetchedAt: now.toISOString(),
      expiresAt: new Date(Math.min(now.getTime() + 3 * 60_000, ...reports.map((report) => Date.parse(report.createdAt) + REPORT_WINDOW_MS))).toISOString(),
      message: reports.length ? "최근 3시간 이용자 제보예요. 현장 상황은 달라질 수 있어요." : "최근 3시간에 올라온 현장 제보가 아직 없어요.",
    };
  } catch {
    return { ...base, status: "unavailable", fetchedAt: now.toISOString(), message: "현장 소식을 불러오지 못했어요. 잠시 후 다시 확인해 주세요." };
  }
}
