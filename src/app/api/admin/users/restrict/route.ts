import { fail, ok } from "@/lib/api";
import { handleAdminWorkerUserRestrictPost } from "@/lib/worker-admin-route";

export async function POST(request: Request) {
  try {
    return ok(await handleAdminWorkerUserRestrictPost(request));
  } catch (error) {
    return fail(error);
  }
}
