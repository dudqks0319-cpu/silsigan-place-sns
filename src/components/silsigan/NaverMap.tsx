"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadNaverMaps, type NaverBounds } from "@/lib/naver-map-loader";

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type MapPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  x?: number;
  y?: number;
  status: string;
  signal: string;
  summary: string;
  crowdLevel: "quiet" | "normal" | "busy" | "packed";
  line: string;
  parking: string;
};

type ClientLocation = {
  latitude: number;
  longitude: number;
};

type NaverMapProps<TPlace extends MapPlace> = {
  places: TPlace[];
  compact?: boolean;
  currentLocation?: ClientLocation | null;
  showTraffic?: boolean;
  onBoundsChange?: (bounds: MapBounds) => void;
  onMapInteraction?: () => void;
  onSelectPlace: (place: TPlace) => void;
};

const nationwideCenter = { latitude: 36.34, longitude: 127.77 };
const maxMarkers = 100;
const naverMapLoadTimeoutMs = 5_000;
const naverMapRenderCheckTimeoutMs = 2_500;
const naverMapRenderCheckIntervalMs = 250;

type MapFailureReason = "sdk" | "resource" | "timeout";

export function NaverMap<TPlace extends MapPlace>({
  places,
  compact = false,
  currentLocation = null,
  showTraffic = false,
  onBoundsChange,
  onMapInteraction,
  onSelectPlace,
}: NaverMapProps<TPlace>) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onMapInteractionRef = useRef(onMapInteraction);
  const onSelectPlaceRef = useRef(onSelectPlace);
  const currentLocationRef = useRef(currentLocation);
  const visiblePlacesRef = useRef<TPlace[]>([]);
  const [ready, setReady] = useState(false);
  const [mapHealthy, setMapHealthy] = useState(false);
  const [failureReason, setFailureReason] = useState<MapFailureReason | null>(null);
  const visiblePlaces = useMemo(() => places.slice(0, maxMarkers), [places]);
  const visiblePlacesKey = visiblePlaces
    .map((place) => `${place.id}:${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}:${place.signal}:${place.parking}:${place.line}`)
    .join("|");
  const currentLocationKey = currentLocation ? `${currentLocation.latitude.toFixed(5)},${currentLocation.longitude.toFixed(5)}` : "";
  const center = useMemo(() => getMapCenter(visiblePlaces, currentLocation), [currentLocation, visiblePlaces]);

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);

  useEffect(() => {
    onMapInteractionRef.current = onMapInteraction;
  }, [onMapInteraction]);

  useEffect(() => {
    onSelectPlaceRef.current = onSelectPlace;
  }, [onSelectPlace]);

  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  useEffect(() => {
    visiblePlacesRef.current = visiblePlaces;
  }, [visiblePlaces]);

  useEffect(() => {
    const placesForFallback = visiblePlacesRef.current;

    if (!ready && placesForFallback.length > 0) {
      onBoundsChangeRef.current?.(boundsForFallbackPlaces(placesForFallback));
    }
  }, [ready, visiblePlacesKey]);

  useEffect(() => {
    const handleNaverResourceError = (event: Event) => {
      const target = event.target as { src?: string; href?: string } | null;
      const source = target?.src ?? target?.href ?? "";
      if (isCriticalNaverMapResource(source)) {
        setFailureReason("resource");
      }
    };

    window.addEventListener("error", handleNaverResourceError, true);

    return () => window.removeEventListener("error", handleNaverResourceError, true);
  }, []);

  useEffect(() => {
    if (failureReason) {
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      if (active && !window.naver?.maps) {
        setFailureReason("timeout");
      }
    }, naverMapLoadTimeoutMs);

    loadNaverMaps()
      .then(() => {
        window.clearTimeout(timeout);
        if (active) {
          setReady(true);
        }
      })
      .catch(() => {
        window.clearTimeout(timeout);
        if (active) {
          setFailureReason("sdk");
        }
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [failureReason]);

  useEffect(() => {
    if (failureReason || !ready || !mapRef.current || !window.naver?.maps) {
      return;
    }

    const { maps } = window.naver;
    const mapElement = mapRef.current;
    const placesForMap = visiblePlacesRef.current;
    const currentLocationForMap = currentLocationRef.current;
    let renderCheckTimer = 0;
    let mapElementClickAttached = false;
    let trafficLayer: { setMap?: (map: unknown | null) => void } | null = null;
    let userMarker: { setMap?: (map: unknown | null) => void } | null = null;
    let markers: Array<{ setMap?: (map: unknown | null) => void }> = [];
    const listeners: Array<{ remove?: () => void } | void> = [];
    const markerListeners: Array<{ remove?: () => void } | void> = [];
    const selectPlaceFromMarkerEvent = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const markerButton = target?.closest<HTMLElement>("[data-silsigan-place-id]");
      const placeId = markerButton?.dataset.silsiganPlaceId;
      const place = placeId ? visiblePlacesRef.current.find((candidate) => candidate.id === placeId) : null;

      if (!place) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSelectPlaceRef.current(place);
    };
    const cleanupMapResources = () => {
      window.clearTimeout(renderCheckTimer);
      if (mapElementClickAttached) {
        mapElement.removeEventListener("click", selectPlaceFromMarkerEvent);
      }
      listeners.forEach((listener) => {
        safeRemoveListener(listener);
      });
      markerListeners.forEach((listener) => {
        safeRemoveListener(listener);
      });
      safeSetMap(trafficLayer, null);
      safeSetMap(userMarker, null);
      markers.forEach((marker) => safeSetMap(marker, null));
      mapInstanceRef.current = null;
    };

    setMapHealthy(false);

    try {
      const map = new maps.Map(mapElement, {
        center: new maps.LatLng(center.latitude, center.longitude),
        zoom: compact ? 7 : 8,
        minZoom: 6,
        maxZoom: 18,
        scaleControl: false,
        logoControl: true,
        mapDataControl: false,
        zoomControl: !compact,
      });
      mapInstanceRef.current = map;

      if (placesForMap.length > 1 && map.fitBounds) {
        const bounds = boundsForPlaces(maps, placesForMap);
        map.fitBounds(bounds);
      }

      trafficLayer = maps.TrafficLayer ? new maps.TrafficLayer() : null;
      trafficLayer?.setMap?.(showTraffic ? map : null);
      const emitBounds = () => {
        if (!map.getBounds) {
          return;
        }

        onBoundsChangeRef.current?.(normalizeBounds(map.getBounds()));
      };
      const debouncedInteraction = debounce(() => {
        onMapInteractionRef.current?.();
        emitBounds();
      }, 350);

      listeners.push(
        maps.Event.addListener(map, "idle", debouncedInteraction),
        maps.Event.addListener(map, "dragend", debouncedInteraction),
        maps.Event.addListener(map, "zoom_changed", debouncedInteraction),
      );
      mapElement.addEventListener("click", selectPlaceFromMarkerEvent);
      mapElementClickAttached = true;
      window.setTimeout(emitBounds, 0);

      const renderCheckStartedAt = Date.now();
      const verifyMapRender = () => {
        if (!mapRef.current) {
          return;
        }

        if (hasKnownNaverMapFailure(mapRef.current)) {
          setFailureReason("resource");
          return;
        }

        if (hasLoadedNaverMapVisual(mapRef.current)) {
          setMapHealthy(true);
          return;
        }

        if (Date.now() - renderCheckStartedAt >= naverMapRenderCheckTimeoutMs) {
          setFailureReason("resource");
          return;
        }

        renderCheckTimer = window.setTimeout(verifyMapRender, naverMapRenderCheckIntervalMs);
      };
      renderCheckTimer = window.setTimeout(verifyMapRender, naverMapRenderCheckIntervalMs);

      markers = placesForMap.map((place) => {
        const markerLabel = markerLabelForPlace(place);
        const markerOffset = markerVisualOffsetForPlace(place, placesForMap);
        const marker = new maps.Marker({
          position: new maps.LatLng(place.latitude, place.longitude),
          map,
          title: place.name,
          zIndex: 100 + Math.max(0, visiblePlacesRef.current.findIndex((candidate) => candidate.id === place.id)),
          icon: {
            content: `<button class="naver-marker naver-marker--${markerToneForPlace(place)}" type="button" data-silsigan-place-id="${escapeHtml(place.id)}" aria-label="${escapeHtml(place.name)} ${escapeHtml(place.signal)} ${escapeHtml(markerLabel)}"></button>`,
            size: new maps.Size(30, 30),
            anchor: new maps.Point(15 - markerOffset.x, 15 - markerOffset.y),
          },
        });
        markerListeners.push(maps.Event.addListener(marker, "click", () => {
          onSelectPlaceRef.current(place);
        }));

        return marker;
      });

      userMarker = currentLocationForMap
        ? new maps.Marker({
            position: new maps.LatLng(currentLocationForMap.latitude, currentLocationForMap.longitude),
            map,
            title: "현재 위치",
            zIndex: 1000,
            icon: {
              content: `<span class="naver-user-marker" aria-label="현재 위치"></span>`,
              size: new maps.Size(28, 28),
              anchor: new maps.Point(14, 14),
            },
          })
        : null;

      return cleanupMapResources;
    } catch {
      cleanupMapResources();
      window.setTimeout(() => setFailureReason("sdk"), 0);
    }
  }, [
    center.latitude,
    center.longitude,
    compact,
    currentLocationKey,
    failureReason,
    ready,
    showTraffic,
    visiblePlacesKey,
  ]);

  const hasNoVisiblePlaces = visiblePlaces.length === 0 && (ready || Boolean(failureReason));

  if (visiblePlaces.length === 0 || failureReason || !ready) {
    return (
      <FallbackMap
        currentLocation={currentLocation}
        empty={hasNoVisiblePlaces}
        failureReason={failureReason}
        loading={!failureReason}
        places={visiblePlaces}
        onMapInteraction={onMapInteraction}
        onSelectPlace={onSelectPlace}
      />
    );
  }

  return (
    <div className="naver-map-shell">
      <div
        className={`naver-map naver-map--live${mapHealthy ? "" : " naver-map--checking"}`}
        ref={mapRef}
        role="img"
        aria-label="네이버 지도 기반 전국 실시간 장소 지도"
        aria-busy={!mapHealthy}
      />
      {!mapHealthy && (
        <FallbackMap
          currentLocation={currentLocation}
          empty={false}
          failureReason={null}
          loading
          overlay
          places={visiblePlaces}
          onMapInteraction={onMapInteraction}
          onSelectPlace={onSelectPlace}
        />
      )}
    </div>
  );
}

function FallbackMap<TPlace extends MapPlace>({
  currentLocation,
  empty,
  failureReason,
  loading,
  overlay = false,
  onMapInteraction,
  onSelectPlace,
  places,
}: {
  currentLocation: ClientLocation | null;
  empty: boolean;
  failureReason: MapFailureReason | null;
  loading: boolean;
  overlay?: boolean;
  onMapInteraction?: () => void;
  onSelectPlace: (place: TPlace) => void;
  places: TPlace[];
}) {
  return (
    <div
      className={`naver-map naver-map--fallback naver-map__fallback${overlay ? " naver-map--fallback-overlay" : ""}`}
      aria-label="클릭 가능한 전국 실시간 장소 지도"
    >
      <div className="naver-map__fallback-status">
        <strong>{fallbackStatusTitle({ empty, failureReason, loading })}</strong>
        <span>{fallbackStatusBody({ empty, failureReason, loading })}</span>
      </div>
      <div
        className="naver-map__fallback-canvas"
        onPointerDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest("button")) {
            return;
          }

          onMapInteraction?.();
        }}
      >
        <span className="naver-map__land naver-map__land--north" />
        <span className="naver-map__land naver-map__land--south" />
        <span className="naver-map__route naver-map__route--one" />
        <span className="naver-map__route naver-map__route--two" />
        <span className="naver-map__label naver-map__label--seoul">서울</span>
        <span className="naver-map__label naver-map__label--gyeongju">경주</span>
        <span className="naver-map__label naver-map__label--busan">부산</span>
        {places.map((place, index) => {
          const position = fallbackPositionForPlace(place, index);
          const tone = markerToneForPlace(place);

          return (
            <button
              key={place.id}
              className={`naver-map__fallback-marker naver-map__fallback-marker--${tone}`}
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              type="button"
              onClick={() => onSelectPlace(place)}
              aria-label={`${place.name} 상세 열기`}
            >
              <span aria-hidden="true" />
            </button>
          );
        })}
        {currentLocation && (
          <span
            className="naver-map__current-location"
            style={{
              left: `${fallbackPositionForLocation(currentLocation).x}%`,
              top: `${fallbackPositionForLocation(currentLocation).y}%`,
            }}
            aria-label="현재 위치"
          />
        )}
      </div>
    </div>
  );
}

function isCriticalNaverMapResource(source: string) {
  return (
    source.includes("nrbe.map.naver.net") ||
    source.includes("oapi.map.naver.com/openapi/v3/maps.js") ||
    source.includes("oapi.map.naver.com/v3/auth")
  );
}

function hasKnownNaverMapFailure(mapElement: HTMLElement) {
  const failedElement = Array.from(mapElement.querySelectorAll("img, [style]")).some((element) => {
    const source = element instanceof HTMLImageElement ? element.currentSrc || element.src : element.getAttribute("style") ?? "";

    return source.includes("auth_fail") || source.includes("oapi.map.naver.com/v3/auth");
  });
  if (failedElement) {
    return true;
  }

  return performance
    .getEntriesByType("resource")
    .some((entry) => entry.name.includes("static.naver.net/maps/mantle/1x/auth_fail.png"));
}

function hasLoadedNaverMapVisual(mapElement: HTMLElement) {
  return Array.from(mapElement.querySelectorAll("img")).some((image) => {
    const source = image.currentSrc || image.src;

    return (
      !source.includes("auth_fail") &&
      (source.includes("nrbe.map.naver.net") || source.includes("static.naver.net/maps")) &&
      image.complete &&
      image.naturalWidth > 8 &&
      image.naturalHeight > 8
    );
  });
}

function safeRemoveListener(listener: { remove?: () => void } | void) {
  try {
    listener?.remove?.();
  } catch {
  }
}

function safeSetMap(target: { setMap?: (map: unknown | null) => void } | null | undefined, map: unknown | null) {
  try {
    target?.setMap?.(map);
  } catch {
  }
}

function fallbackStatusTitle({
  empty,
  failureReason,
  loading,
}: {
  empty: boolean;
  failureReason: MapFailureReason | null;
  loading: boolean;
}) {
  if (empty) return "표시할 장소 없음";
  if (loading) return "지도 연결 중";
  if (failureReason === "timeout") return "지도 응답 지연";
  if (failureReason) return "대체 지도 표시 중";
  return "전국 실시간 지도";
}

function fallbackStatusBody({
  empty,
  failureReason,
  loading,
}: {
  empty: boolean;
  failureReason: MapFailureReason | null;
  loading: boolean;
}) {
  if (empty) return "지역이나 필터를 바꾸면 지도 후보를 다시 볼 수 있어요.";
  if (loading) return "네이버 지도 연결 전에도 장소를 선택할 수 있어요.";
  if (failureReason) return "네이버 지도 연결이 불안정해 대체 지도로 표시합니다. 핀을 누르면 장소 사진과 상태를 볼 수 있어요.";
  return "마커를 누르면 장소 상세가 열립니다.";
}

function getMapCenter(places: MapPlace[], currentLocation: ClientLocation | null) {
  if (currentLocation) {
    return currentLocation;
  }

  if (places.length === 0) {
    return nationwideCenter;
  }

  return {
    latitude: places.reduce((sum, place) => sum + place.latitude, 0) / places.length,
    longitude: places.reduce((sum, place) => sum + place.longitude, 0) / places.length,
  };
}

function boundsForPlaces(maps: NonNullable<Window["naver"]>["maps"], places: MapPlace[]) {
  const latitudes = places.map((place) => place.latitude);
  const longitudes = places.map((place) => place.longitude);
  const southWest = new maps.LatLng(Math.min(...latitudes), Math.min(...longitudes));
  const northEast = new maps.LatLng(Math.max(...latitudes), Math.max(...longitudes));

  return new maps.LatLngBounds(southWest, northEast);
}

function boundsForFallbackPlaces(places: MapPlace[]): MapBounds {
  const latitudes = places.map((place) => place.latitude);
  const longitudes = places.map((place) => place.longitude);

  return {
    north: Math.max(...latitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    west: Math.min(...longitudes),
  };
}

function normalizeBounds(bounds: NaverBounds): MapBounds {
  const northEast = bounds.getNE();
  const southWest = bounds.getSW();

  return {
    north: northEast.lat(),
    south: southWest.lat(),
    east: northEast.lng(),
    west: southWest.lng(),
  };
}

function debounce(callback: () => void, delayMs: number) {
  let timer = 0;

  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(callback, delayMs);
  };
}

function markerLabelForPlace(place: MapPlace) {
  if (place.parking === "만차") {
    return "주차 만차";
  }

  if (place.line === "김") {
    return "줄 김";
  }

  if (place.crowdLevel === "quiet") {
    return "한산";
  }

  if (place.crowdLevel === "busy" || place.crowdLevel === "packed") {
    return "혼잡";
  }

  return place.signal;
}

function markerToneForPlace(place: MapPlace) {
  if (place.signal === "가도 좋음") return "good";
  if (place.signal === "대기 보통") return "normal";
  if (place.signal === "혼잡 주의") return "busy";
  return "avoid";
}

function fallbackPositionForPlace(place: MapPlace, index: number) {
  if (typeof place.x === "number" && typeof place.y === "number") {
    return {
      x: clampPercent(place.x),
      y: clampPercent(place.y),
    };
  }

  const projected = fallbackPositionForLocation(place);
  const offset = (index % 3) * 2;

  return {
    x: clampPercent(projected.x + offset),
    y: clampPercent(projected.y - offset),
  };
}

function fallbackPositionForLocation(location: ClientLocation) {
  const west = 124.6;
  const east = 131.2;
  const south = 33.0;
  const north = 38.7;

  return {
    x: clampPercent(((location.longitude - west) / (east - west)) * 100),
    y: clampPercent(100 - ((location.latitude - south) / (north - south)) * 100),
  };
}

function clampPercent(value: number) {
  return Math.min(92, Math.max(8, value));
}

function markerVisualOffsetForPlace(place: MapPlace, places: MapPlace[]) {
  const cluster = places.filter((candidate) => arePlacesVisuallyClose(place, candidate));

  if (cluster.length < 2) {
    return { x: 0, y: 0 };
  }

  const offsets = [
    { x: -34, y: -14 },
    { x: 34, y: 14 },
    { x: -28, y: 22 },
    { x: 28, y: -22 },
    { x: 0, y: 0 },
  ];
  const clusterIndex = cluster.findIndex((candidate) => candidate.id === place.id);

  return offsets[Math.max(0, clusterIndex) % offsets.length];
}

function arePlacesVisuallyClose(place: MapPlace, candidate: MapPlace) {
  return Math.abs(place.latitude - candidate.latitude) <= 0.35 && Math.abs(place.longitude - candidate.longitude) <= 0.45;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
