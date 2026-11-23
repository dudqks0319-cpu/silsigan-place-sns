"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlaceCategory, RegionSnapshot } from "../types";

type SnapshotState = { key: string; data: RegionSnapshot | null; loading: boolean; error: string | null };

export function useRegionSnapshot(regionId: string, category: PlaceCategory, query: string) {
  const key = `${regionId}:${category}:${query}`;
  const [state, setState] = useState<SnapshotState>({ key: "", data: null, loading: true, error: null });
  const [refreshCount, setRefreshCount] = useState(0);
  const [online, setOnline] = useState(true);
  const refresh = useCallback(() => setRefreshCount((count) => count + 1), []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;
    let lastCompletedAt = 0;

    async function load() {
      if (inFlight || !active) return;
      if (!navigator.onLine) {
        setOnline(false);
        setState((previous) => ({ key, data: previous.key === key ? previous.data : null, loading: false, error: "인터넷 연결을 확인해 주세요. 연결되면 다시 불러올게요." }));
        return;
      }
      inFlight = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort("timeout"), 18_000);
      setState((previous) => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: null }));
      try {
        const parameters = new URLSearchParams({ region: regionId, category });
        if (query.trim()) parameters.set("q", query.trim());
        const response = await fetch(`/api/local-live?${parameters}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.success || !body.data) throw new Error("지역 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        if (active) {
          setState({ key, data: body.data as RegionSnapshot, loading: false, error: null });
          lastCompletedAt = Date.now();
        }
      } catch {
        if (active) setState((previous) => ({ key, data: previous.key === key ? previous.data : null, loading: false, error: "지역 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }));
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
      }
    }

    const startup = window.setTimeout(() => { setOnline(navigator.onLine); void load(); }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void load();
    }, 180_000);
    const onOnline = () => { setOnline(true); void load(); };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine && Date.now() - lastCompletedAt >= 180_000) void load();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearTimeout(startup);
      window.clearInterval(interval);
      controller?.abort();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [regionId, category, query, key, refreshCount]);

  return {
    data: state.key === key ? state.data : null,
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    online,
    refresh,
  };
}
