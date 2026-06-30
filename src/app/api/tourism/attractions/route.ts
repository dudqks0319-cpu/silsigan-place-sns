import { fail, ok } from "@/lib/api";
import { listPlaces } from "@/lib/mock-store";
import { listPlacesSchema } from "@/lib/validators";

type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = listPlacesSchema.parse({
      regionId: url.searchParams.get("regionId") ?? url.searchParams.get("region") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const bbox = parseBBox(url.searchParams.get("bbox"));
    const places = listPlaces({ regionId: filters.regionId, limit: 200 })
      .filter((place) => place.category === "tourism")
      .filter((place) => isPlaceInBBox(place, bbox))
      .slice(0, filters.limit)
      .map((place) => ({
        ...place,
        source: "tourapi-fallback",
      }));

    return ok(places, {
      limit: filters.limit,
      provider: "tourapi-fallback",
      configured: false,
      bboxApplied: Boolean(bbox),
      reason: "TOUR_API_SERVICE_KEY_REQUIRED",
    });
  } catch (error) {
    return fail(error);
  }
}

function parseBBox(value: string | null): BBox | null {
  if (!value) {
    return null;
  }

  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [west, south, east, north] = parts;

  return { west, south, east, north };
}

function isPlaceInBBox(place: { latitude: number; longitude: number }, bbox: BBox | null) {
  if (!bbox) {
    return true;
  }

  return place.latitude <= bbox.north && place.latitude >= bbox.south && place.longitude <= bbox.east && place.longitude >= bbox.west;
}
