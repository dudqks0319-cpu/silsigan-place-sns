import { fail, ok } from "@/lib/api";
import { handleAdminWorkerUserUnrestrictPost } from "@/lib/worker-admin-route";

export async function POST(request: Request) {
  try {
    return ok(await handleAdminWorkerUserUnrestrictPost(request));
  } catch (error) {
    return fail(error);
  }
}
