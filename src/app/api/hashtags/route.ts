import { fail, ok } from "@/lib/api";
import { assertLocalDemoApiAvailable } from "@/lib/runtime-data-mode";
import { store } from "@/lib/store";

export async function GET() {
  try {
    assertLocalDemoApiAvailable();
    return ok(await store.listHashtags(), {
      policy: "게시물당 해시태그는 최대 5개이며 장소, 상태, 목적, 시간, 지역 태그를 우선 추천합니다.",
    });
  } catch (error) {
    return fail(error);
  }
}
