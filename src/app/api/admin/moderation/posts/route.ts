import { assertAdminRequest } from "@/lib/admin-auth";
import { fail, ok } from "@/lib/api";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { store } from "@/lib/store";

export async function GET(request: Request) {
  try {
    assertAdminRequest(request);

    return ok(await store.listPostModerationQueue());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertAdminRequest(request);
    assertRateLimit({ key: rateLimitKey(request, "admin-moderate-post"), limit: 30, windowMs: 60_000 });
    const input = (await request.json()) as { postId?: string; action?: "keep" | "hide" | "delete" | "restrict_author" };

    if (!input.postId || !input.action) {
      return ok({ skipped: true }, { warning: "postId와 action이 필요합니다." });
    }

    return ok(await store.moderatePost({ postId: input.postId, action: input.action }));
  } catch (error) {
    return fail(error);
  }
}
