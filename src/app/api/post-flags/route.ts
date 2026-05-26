import { fail, ok } from "@/lib/api";
import { flagPost } from "@/lib/mock-store";
import { flagPostSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const input = flagPostSchema.parse(await request.json());

    return ok(flagPost(input), {
      moderation: "개인정보와 민감정보 신고는 임시 숨김을 우선합니다.",
    });
  } catch (error) {
    return fail(error);
  }
}
