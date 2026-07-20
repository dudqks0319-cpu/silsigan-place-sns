import { fail, ok } from "@/lib/api";
import { handleAdminPlaceRequestsGet, handleAdminPlaceRequestsPost } from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminPlaceRequestsGet(request));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await handleAdminPlaceRequestsPost(request));
  } catch (error) {
    return fail(error);
  }
}
