import { fail, ok } from "@/lib/api";
import { handleAdminBetaKpisGet } from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminBetaKpisGet(request));
  } catch (error) {
    return fail(error);
  }
}
