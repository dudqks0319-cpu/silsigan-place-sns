import { fail, ok } from "@/lib/api";
import { handleAdminWorkerFieldReportsGet, handleAdminWorkerFieldReportsPost } from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminWorkerFieldReportsGet(request));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await handleAdminWorkerFieldReportsPost(request));
  } catch (error) {
    return fail(error);
  }
}
