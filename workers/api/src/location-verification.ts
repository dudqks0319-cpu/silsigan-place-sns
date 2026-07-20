import { distanceMeters } from "./policies.ts";

export const verificationMethods = ["none", "radius", "polygon"] as const;
export type FieldVerificationMethod = (typeof verificationMethods)[number];

export type VerificationPlaceKind = "POINT" | "AREA" | "ROUTE" | "FACILITY_GROUP";
export type VerificationPoint = { latitude: number; longitude: number };
type CoordinatePair = readonly [longitude: number, latitude: number];

export type VerificationGeometry =
  | {
      type: "Polygon";
      coordinates: readonly (readonly CoordinatePair[])[];
    }
  | {
      type: "MultiPolygon";
      coordinates: readonly (readonly (readonly CoordinatePair[])[])[];
    };

export type PlaceVerificationContext = {
  placeKind: VerificationPlaceKind;
  center: VerificationPoint;
  geometry: VerificationGeometry | null;
  verificationRadiusM: number | null;
};

export type FieldLocationVerification = {
  verificationMethod: FieldVerificationMethod;
  verifiedRadiusM: 50 | 150 | 300 | null;
  reason:
    | "verified"
    | "no_location"
    | "low_accuracy"
    | "outside_radius"
    | "outside_polygon"
    | "geometry_not_configured"
    | "radius_not_configured";
};

const MAX_GEOMETRY_POINTS = 5_000;
const MAX_VERIFICATION_ACCURACY_M = 100;
const DEFAULT_POINT_VERIFICATION_RADIUS_M = 300;

export function parseVerificationGeometry(value: unknown): VerificationGeometry | null {
  if (!isRecord(value) || (value.type !== "Polygon" && value.type !== "MultiPolygon")) {
    return null;
  }

  if (value.type === "Polygon") {
    const rings = parseRings(value.coordinates);
    return rings ? { type: "Polygon", coordinates: rings } : null;
  }

  if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
    return null;
  }

  const polygons: Array<readonly (readonly CoordinatePair[])[]> = [];
  for (const polygon of value.coordinates) {
    const rings = parseRings(polygon);
    if (!rings) {
      return null;
    }
    polygons.push(rings);
  }

  return { type: "MultiPolygon", coordinates: polygons };
}

export function pointInVerificationGeometry(point: VerificationPoint, geometry: VerificationGeometry): boolean {
  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates);
  }

  return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
}

export function verifyFieldLocation(
  point: VerificationPoint | null,
  accuracyM: number | null,
  context: PlaceVerificationContext,
): FieldLocationVerification {
  if (!point) {
    return unverified("no_location");
  }

  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0 || accuracyM > MAX_VERIFICATION_ACCURACY_M) {
    return unverified("low_accuracy");
  }

  if (context.placeKind === "AREA" || context.geometry) {
    if (!context.geometry) {
      return unverified("geometry_not_configured");
    }

    return pointInVerificationGeometry(point, context.geometry)
      ? { verificationMethod: "polygon", verifiedRadiusM: null, reason: "verified" }
      : unverified("outside_polygon");
  }

  if (context.placeKind === "ROUTE") {
    return unverified("geometry_not_configured");
  }

  const configuredRadiusM = context.verificationRadiusM ?? DEFAULT_POINT_VERIFICATION_RADIUS_M;
  if (!Number.isFinite(configuredRadiusM) || configuredRadiusM < 50 || configuredRadiusM > DEFAULT_POINT_VERIFICATION_RADIUS_M) {
    return unverified("radius_not_configured");
  }

  const distanceM = distanceMeters(point, contextPoint(context));
  if (distanceM > configuredRadiusM) {
    return unverified("outside_radius");
  }

  const verifiedRadiusM = distanceM <= 50 ? 50 : distanceM <= 150 ? 150 : 300;
  return { verificationMethod: "radius", verifiedRadiusM, reason: "verified" };
}

function contextPoint(context: PlaceVerificationContext): VerificationPoint {
  return context.center;
}

function unverified(reason: FieldLocationVerification["reason"]): FieldLocationVerification {
  return { verificationMethod: "none", verifiedRadiusM: null, reason };
}

function parseRings(value: unknown): Array<readonly CoordinatePair[]> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const rings: Array<readonly CoordinatePair[]> = [];
  let pointCount = 0;
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 4) {
      return null;
    }
    pointCount += ring.length;
    if (pointCount > MAX_GEOMETRY_POINTS) {
      return null;
    }

    const points: CoordinatePair[] = [];
    for (const coordinate of ring) {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        return null;
      }
      const longitude = coordinate[0];
      const latitude = coordinate[1];
      if (
        typeof longitude !== "number" ||
        typeof latitude !== "number" ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        longitude < -180 ||
        longitude > 180 ||
        latitude < -90 ||
        latitude > 90
      ) {
        return null;
      }
      points.push([longitude, latitude]);
    }

    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      return null;
    }
    rings.push(points);
  }

  return rings;
}

function pointInPolygon(point: VerificationPoint, rings: readonly (readonly CoordinatePair[])[]): boolean {
  const exterior = rings[0];
  if (!exterior || !pointInRing(point, exterior)) {
    return false;
  }

  return rings.slice(1).every((hole) => !pointInRing(point, hole));
}

function pointInRing(point: VerificationPoint, ring: readonly CoordinatePair[]): boolean {
  let inside = false;
  const { latitude, longitude } = point;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLongitude, currentLatitude] = ring[index] ?? [0, 0];
    const [previousLongitude, previousLatitude] = ring[previous] ?? [0, 0];
    if (pointOnSegment(longitude, latitude, previousLongitude, previousLatitude, currentLongitude, currentLatitude)) {
      return true;
    }

    const crosses = (currentLatitude > latitude) !== (previousLatitude > latitude);
    if (crosses) {
      const intersectionLongitude =
        ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
        currentLongitude;
      if (longitude < intersectionLongitude) {
        inside = !inside;
      }
    }
  }

  return inside;
}

function pointOnSegment(
  longitude: number,
  latitude: number,
  startLongitude: number,
  startLatitude: number,
  endLongitude: number,
  endLatitude: number,
): boolean {
  const cross = (latitude - startLatitude) * (endLongitude - startLongitude) - (longitude - startLongitude) * (endLatitude - startLatitude);
  if (Math.abs(cross) > 1e-10) {
    return false;
  }

  return (
    longitude >= Math.min(startLongitude, endLongitude) - 1e-10 &&
    longitude <= Math.max(startLongitude, endLongitude) + 1e-10 &&
    latitude >= Math.min(startLatitude, endLatitude) - 1e-10 &&
    latitude <= Math.max(startLatitude, endLatitude) + 1e-10
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
