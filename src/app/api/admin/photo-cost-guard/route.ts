import { fail, ok } from "@/lib/api";
import { handleAdminPhotoCostGuardGet, handleAdminPhotoCostGuardPatch } from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminPhotoCostGuardGet(request));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    return ok(await handleAdminPhotoCostGuardPatch(request));
  } catch (error) {
    return fail(error);
  }
}
