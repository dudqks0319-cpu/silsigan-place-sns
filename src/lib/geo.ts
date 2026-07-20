export type GeoPoint = {
  latitude: number;
  longitude: number;
};

const earthRadiusMeters = 6_371_000;

export function haversineDistanceMeters(from: GeoPoint, to: GeoPoint): number {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function formatDistanceMeters(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return "거리 확인 전";
  }

  if (distanceMeters < 1_000) {
    return `${Math.max(1, Math.round(distanceMeters / 10) * 10)}m`;
  }

  return `${(distanceMeters / 1_000).toFixed(distanceMeters >= 10_000 ? 0 : 1)}km`;
}

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}
