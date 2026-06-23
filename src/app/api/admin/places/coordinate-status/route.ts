import { fail, ok } from "@/lib/api";
import { handleAdminWorkerCoordinateStatusPost } from "@/lib/worker-admin-route";

export async function POST(request: Request) {
  try {
    return ok(await handleAdminWorkerCoordinateStatusPost(request));
  } catch (error) {
    return fail(error);
  }
}
