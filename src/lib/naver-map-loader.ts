"use client";

export type NaverMapsNamespace = {
  Event: {
    addListener: (target: unknown, eventName: string, listener: () => void) => { remove?: () => void } | void;
  };
  LatLng: new (lat: number, lng: number) => unknown;
  LatLngBounds: new (southWest: unknown, northEast: unknown) => unknown;
  Map: new (
    element: HTMLElement,
    options: {
      center: unknown;
      zoom: number;
      minZoom?: number;
      maxZoom?: number;
      scaleControl?: boolean;
      logoControl?: boolean;
      mapDataControl?: boolean;
      zoomControl?: boolean;
    },
  ) => {
    fitBounds?: (bounds: unknown) => void;
    getBounds?: () => NaverBounds;
    setCenter?: (center: unknown) => void;
  };
  Marker: new (options: {
    position: unknown;
    map: unknown;
    title?: string;
    icon?: {
      content: string;
      size?: unknown;
      anchor?: unknown;
    };
    zIndex?: number;
  }) => { setMap: (map: unknown | null) => void };
  Point: new (x: number, y: number) => unknown;
  Size: new (width: number, height: number) => unknown;
  TrafficLayer?: new () => { setMap: (map: unknown | null) => void };
};

export type NaverBounds = {
  getNE: () => { lat: () => number; lng: () => number };
  getSW: () => { lat: () => number; lng: () => number };
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
let pendingLoad: Promise<NaverMapsNamespace> | null = null;
let scriptLoadStartedAt = 0;

const naverMapScriptId = "naver-map-sdk";
const naverMapScriptTimeoutMs = 8_000;

export function loadNaverMaps(): Promise<NaverMapsNamespace> {
  if (!naverMapClientId) {
    return Promise.reject(new Error("NAVER_MAP_CLIENT_ID_MISSING"));
  }

  if (window.naver?.maps) {
    return Promise.resolve(window.naver.maps);
  }

  if (pendingLoad) {
    return pendingLoad;
  }

  pendingLoad = new Promise<NaverMapsNamespace>((resolve, reject) => {
    const rejectAndReset = (error: Error) => {
      pendingLoad = null;
      reject(error);
    };

    const resolveIfReady = () => {
      if (window.naver?.maps) {
        resolve(window.naver.maps);
        return true;
      }

      return false;
    };

    window.__silsiganNaverMapReady = () => {
      if (!resolveIfReady()) {
        rejectAndReset(new Error("NAVER_MAP_SDK_UNAVAILABLE"));
      }
    };

    const existing = document.getElementById(naverMapScriptId);
    if (existing) {
      const script = existing instanceof HTMLScriptElement ? existing : null;
      const startedAt = Number(script?.dataset.silsiganStartedAt) || scriptLoadStartedAt || Date.now();
      scriptLoadStartedAt = startedAt;
      if (resolveIfReady()) {
        return;
      }

      script?.addEventListener("load", resolveIfReady, { once: true });
      script?.addEventListener("error", () => rejectAndReset(new Error("NAVER_MAP_SDK_LOAD_FAILED")), { once: true });
      window.setTimeout(() => {
        if (!window.naver?.maps && Date.now() - startedAt >= naverMapScriptTimeoutMs) {
          pendingLoad = null;
          script?.remove();
          reject(new Error("NAVER_MAP_SDK_TIMEOUT"));
        }
      }, naverMapScriptTimeoutMs);
      return;
    }

    const script = document.createElement("script");
    script.id = naverMapScriptId;
    script.async = true;
    scriptLoadStartedAt = Date.now();
    script.dataset.silsiganStartedAt = String(scriptLoadStartedAt);
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(
      naverMapClientId,
    )}&callback=__silsiganNaverMapReady`;
    script.onload = () => {
      resolveIfReady();
    };
    script.onerror = () => rejectAndReset(new Error("NAVER_MAP_SDK_LOAD_FAILED"));
    document.head.appendChild(script);
  });

  return pendingLoad;
}
