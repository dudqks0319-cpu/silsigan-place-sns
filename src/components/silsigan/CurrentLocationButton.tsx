"use client";

import { LocateFixed, MapPinOff } from "lucide-react";
import styles from "./SilsiganRedesign.module.css";

export type LocationPermissionState = "idle" | "requesting" | "granted" | "denied" | "unsupported";

export type UiLocation = {
  latitude: number;
  longitude: number;
  accuracyM?: number;
};

export function CurrentLocationButton({
  onLocation,
  onPermissionChange,
  permission,
}: {
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
          accuracyM: position.coords.accuracy,
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

  const denied = permission === "denied" || permission === "unsupported";

  return (
    <button className={styles.locationButton} type="button" onClick={requestLocation} aria-label="현재 위치로 지도 보기">
      {denied ? <MapPinOff size={17} /> : <LocateFixed size={17} />}
      {permission === "requesting" ? "위치 확인 중" : denied ? "지역 탭으로 보기" : "현재 위치"}
    </button>
  );
}
