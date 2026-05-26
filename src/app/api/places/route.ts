import { fail, ok } from "@/lib/api";
import { listPlaces } from "@/lib/mock-store";

export async function GET() {
  try {
    return ok(listPlaces());
  } catch (error) {
    return fail(error);
  }
}
