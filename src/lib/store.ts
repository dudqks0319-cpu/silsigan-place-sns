import { ApiError } from "./errors.ts";
import {
  createPost,
  flagPost,
  listHashtags,
  listPosts,
} from "./mock-store.ts";
import { createSupabaseStore } from "./supabase-store.ts";

export type SilsiganStore = {
  createPost: typeof createPost;
  flagPost: typeof flagPost;
  listHashtags: typeof listHashtags;
  listPosts: typeof listPosts;
};

const demoStore: SilsiganStore = {
  createPost,
  flagPost,
  listHashtags,
  listPosts,
};

export function getStore(driver = process.env.SILSIGAN_STORE_DRIVER ?? "demo"): SilsiganStore {
  if (driver === "demo" || driver === "mock") {
    return demoStore;
  }

  if (driver === "supabase") {
    return createSupabaseStore();
  }

  throw new ApiError(500, "UNKNOWN_STORE_DRIVER", "알 수 없는 저장소 드라이버입니다.");
}

export const store = getStore();
