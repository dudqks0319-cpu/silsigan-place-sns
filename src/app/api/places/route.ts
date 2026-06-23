import { fail, ok } from "@/lib/api";
import { listPlaces } from "@/lib/mock-store";
import { listPlacesSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = listPlacesSchema.parse({
      regionId: url.searchParams.get("regionId") ?? url.searchParams.get("region") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    return ok(listPlaces(filters));
  } catch (error) {
    return fail(error);
  }
}
