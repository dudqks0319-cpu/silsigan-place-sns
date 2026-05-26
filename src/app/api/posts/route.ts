import { fail, ok } from "@/lib/api";
import { createPost, listPosts } from "@/lib/mock-store";
import { createPostSchema, listPostsSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = listPostsSchema.parse({
      placeId: url.searchParams.get("placeId") ?? undefined,
      hashtagName: url.searchParams.get("hashtagName") ?? undefined,
      includeHidden: url.searchParams.get("includeHidden") ?? undefined,
    });

    return ok(listPosts(filters), {
      ranking: "최근 현장 인증, 판단 도움도, 사진, 질문 반응 순으로 정렬합니다.",
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createPostSchema.parse(await request.json());

    return ok(createPost(input));
  } catch (error) {
    return fail(error);
  }
}
