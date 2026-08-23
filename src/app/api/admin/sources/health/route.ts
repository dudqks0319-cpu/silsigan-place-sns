import { fail, ok } from "@/lib/api";
import { handleAdminWorkerSourceHealthGet } from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminWorkerSourceHealthGet(request));
  } catch (error) {
    return fail(error);
  }
}
