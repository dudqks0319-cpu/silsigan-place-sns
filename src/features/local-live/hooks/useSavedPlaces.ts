"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocalPlace } from "../types";

const STORAGE_KEY = "silsigan:saved-places:v1";

function isSavedPlace(value: unknown): value is LocalPlace {
  if (!value || typeof value !== "object") return false;
  const place = value as Record<string, unknown>;
  return ["id", "name", "address", "categoryLabel", "sourceName", "sourceUrl", "mapUrl"].every((key) => typeof place[key] === "string")
    && ["attraction", "restaurant", "cafe", "parking", "family"].includes(String(place.category))
    && typeof place.latitude === "number" && Number.isFinite(place.latitude)
    && typeof place.longitude === "number" && Number.isFinite(place.longitude)
    && (place.phone === null || typeof place.phone === "string");
}

export function useSavedPlaces() {
  const [saved, setSaved] = useState<LocalPlace[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        setSaved(Array.isArray(parsed) ? parsed.filter(isSavedPlace).slice(0, 200) : []);
      } catch {
        setWarning("이 브라우저에서 저장한 장소를 불러오지 못했어요.");
      }
    };
    const timer = window.setTimeout(read, 0);
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) read(); };
    window.addEventListener("storage", onStorage);
    return () => { window.clearTimeout(timer); window.removeEventListener("storage", onStorage); };
  }, []);

  const toggle = useCallback((place: LocalPlace) => {
    const next = saved.some((item) => item.id === place.id)
      ? saved.filter((item) => item.id !== place.id)
      : [place, ...saved].slice(0, 200);
    setSaved(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { setWarning("브라우저 저장 공간을 사용할 수 없어 이번 방문 동안만 보관돼요."); }
  }, [saved]);

  return { saved, toggle, warning, isSaved: (id: string) => saved.some((place) => place.id === id) };
}
