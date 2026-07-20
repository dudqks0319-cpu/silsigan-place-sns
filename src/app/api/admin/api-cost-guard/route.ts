import { fail, ok } from "@/lib/api";
import {
  handleAdminApiCostGuardGet,
  handleAdminApiCostGuardPatch,
  handleAdminApiCostGuardReconcile,
} from "@/lib/worker-admin-route";

export async function GET(request: Request) {
  try {
    return ok(await handleAdminApiCostGuardGet(request));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    return ok(await handleAdminApiCostGuardPatch(request));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await handleAdminApiCostGuardReconcile(request));
  } catch (error) {
    return fail(error);
  }
}
