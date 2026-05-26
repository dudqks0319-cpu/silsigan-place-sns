"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type MapPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: string;
  crowdLevel: "quiet" | "normal" | "busy" | "packed";
  line: string;
  parking: string;
};

type NaverMapProps<TPlace extends MapPlace> = {
  places: TPlace[];
  compact?: boolean;
  onSelectPlace: (place: TPlace) => void;
};

type NaverMapsNamespace = {
  Event: {
    addListener: (target: unknown, eventName: string, listener: () => void) => void;
  };
  LatLng: new (lat: number, lng: number) => unknown;
  Map: new (
    element: HTMLElement,
    options: {
      center: unknown;
      zoom: number;
      minZoom?: number;
      scaleControl?: boolean;
      logoControl?: boolean;
      mapDataControl?: boolean;
      zoomControl?: boolean;
    },
  ) => unknown;
  Marker: new (options: {
    position: unknown;
    map: unknown;
    title: string;
    icon?: {
      content: string;
      size?: unknown;
      anchor?: unknown;
    };
  }) => { setMap: (map: unknown | null) => void };
  Point: new (x: number, y: number) => unknown;
  Size: new (width: number, height: number) => unknown;
};

declare global {
  interface Window {
    naver?: {
      maps: NaverMapsNamespace;
    };
    __silsiganNaverMapReady?: () => void;
  }
}

const naverMapClientId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;

export function NaverMap<TPlace extends MapPlace>({ places, compact = false, onSelectPlace }: NaverMapProps<TPlace>) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const center = useMemo(() => getMapCenter(places), [places]);

  useEffect(() => {
    if (!naverMapClientId) {
      return;
    }

    if (window.naver?.maps) {
      const timer = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(timer);
    }

    const existing = document.getElementById("naver-map-sdk");
    window.__silsiganNaverMapReady = () => setReady(true);

    if (existing) {
      return;
    }

    const script = document.createElement("script");
    script.id = "naver-map-sdk";
    script.async = true;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(
      naverMapClientId,
    )}&callback=__silsiganNaverMapReady`;
    script.onerror = () => setFailed(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.naver?.maps || places.length === 0) {
      return;
    }

    const { maps } = window.naver;
    const map = new maps.Map(mapRef.current, {
      center: new maps.LatLng(center.latitude, center.longitude),
      zoom: compact ? 11 : 10,
      minZoom: 7,
      scaleControl: false,
      logoControl: true,
      mapDataControl: false,
      zoomControl: !compact,
    });
    const markers = places.map((place) => {
      const markerLabel = markerLabelForPlace(place);
      const marker = new maps.Marker({
        position: new maps.LatLng(place.latitude, place.longitude),
        map,
        title: place.name,
        icon: {
          content: `<button class="naver-marker naver-marker--${place.crowdLevel}" aria-label="${place.name}">${markerLabel}</button>`,
          size: new maps.Size(58, 34),
          anchor: new maps.Point(29, 17),
        },
      });
      maps.Event.addListener(marker, "click", () => onSelectPlace(place));

      return marker;
    });

    return () => {
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [center.latitude, center.longitude, compact, onSelectPlace, places, ready]);

  if (!naverMapClientId || failed) {
    return (
      <div className="naver-map naver-map--fallback">
        <strong>지도가 잠시 준비 중이에요</strong>
        <p>아래 현장 목록에서 바로 확인할 수 있어요.</p>
      </div>
    );
  }

  return <div className="naver-map" ref={mapRef} role="img" aria-label="네이버 지도 기반 주변 현장" />;
}

function getMapCenter(places: MapPlace[]) {
  if (places.length === 0) {
    return { latitude: 35.5486, longitude: 129.3005 };
  }

  return {
    latitude: places.reduce((sum, place) => sum + place.latitude, 0) / places.length,
    longitude: places.reduce((sum, place) => sum + place.longitude, 0) / places.length,
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

  return place.status;
}
