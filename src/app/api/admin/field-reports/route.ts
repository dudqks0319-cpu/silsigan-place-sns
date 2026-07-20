import { fail, ok } from "@/lib/api";
import { handleAdminFieldReportsGet, handleAdminFieldReportsPost } from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminFieldReportsGet(request));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await handleAdminFieldReportsPost(request));
  } catch (error) {
    return fail(error);
  }
}
