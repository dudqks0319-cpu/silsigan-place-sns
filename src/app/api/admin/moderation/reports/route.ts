import { fail, ok } from "@/lib/api";
import { handleAdminWorkerReportsGet, handleAdminWorkerReportsPost } from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminWorkerReportsGet(request));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await handleAdminWorkerReportsPost(request));
  } catch (error) {
    return fail(error);
  }
}
