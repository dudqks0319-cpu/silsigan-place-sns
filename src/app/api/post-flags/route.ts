import { fail, ok } from "@/lib/api";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { store } from "@/lib/store";
import { flagPostSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    assertRateLimit({ key: rateLimitKey(request, "flag-post"), limit: 20, windowMs: 60_000 });
    const input = flagPostSchema.parse(await request.json());

    return ok(await store.flagPost(input), {
      moderation: "개인정보와 민감정보 신고는 임시 숨김을 우선합니다.",
    });
  } catch (error) {
    return fail(error);
  }
}
