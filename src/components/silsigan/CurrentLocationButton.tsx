"use client";

import { LocateFixed, MapPinOff } from "lucide-react";
import styles from "./SilsiganRedesign.module.css";

export type LocationPermissionState = "idle" | "requesting" | "granted" | "denied" | "unsupported";

export type UiLocation = {
  latitude: number;
  longitude: number;
};

export function CurrentLocationButton({
  ariaLabel = "현재 위치로 지도 보기",
  onLocation,
  onPermissionChange,
  permission,
}: {
  ariaLabel?: string;
  onLocation: (location: UiLocation | null) => void;
  onPermissionChange: (permission: LocationPermissionState) => void;
  permission: LocationPermissionState;
}) {
  const requestLocation = () => {
    if (!navigator.geolocation) {
      onLocation(null);
      onPermissionChange("unsupported");
      return;
    }

    onPermissionChange("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        onPermissionChange("granted");
      },
      () => {
        onLocation(null);
        onPermissionChange("denied");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 7_000,
      },
    );
  };

  const requesting = permission === "requesting";
  const granted = permission === "granted";
  const denied = permission === "denied";
  const unsupported = permission === "unsupported";
  const label = requesting
    ? "위치 확인 중"
    : granted
      ? "내 위치 표시 중"
      : denied
        ? "다시 요청"
        : unsupported
          ? "위치 사용 불가"
          : "내 위치 표시";

  return (
    <button
      className={styles.locationButton}
      type="button"
      onClick={requestLocation}
      aria-label={granted ? "현재 위치 다시 확인" : ariaLabel}
      aria-pressed={permission === "granted"}
      disabled={requesting || unsupported}
    >
      {denied || unsupported ? <MapPinOff size={17} aria-hidden="true" /> : <LocateFixed size={17} aria-hidden="true" />}
      {label}
    </button>
  );
}
