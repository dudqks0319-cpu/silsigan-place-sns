import { ok } from "@/lib/api";
import { store } from "@/lib/store";

export async function GET() {
  return ok(store.listHashtags(), {
    policy: "게시물당 해시태그는 최대 5개이며 장소, 상태, 목적, 시간, 지역 태그를 우선 추천합니다.",
  });
}
