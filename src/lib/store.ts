import { ApiError } from "./errors.ts";
import {
  createPost,
  flagPost,
  listPostModerationQueue,
  listHashtags,
  listPosts,
  moderatePost,
} from "./mock-store.ts";
import { createSupabaseStore } from "./supabase-store.ts";

type Awaitable<T> = T | Promise<T>;

export type SilsiganStore = {
  createPost: (input: Parameters<typeof createPost>[0]) => Awaitable<ReturnType<typeof createPost>>;
  flagPost: (input: Parameters<typeof flagPost>[0]) => Awaitable<ReturnType<typeof flagPost>>;
  listHashtags: () => Awaitable<ReturnType<typeof listHashtags>>;
  listPosts: (filters?: Parameters<typeof listPosts>[0]) => Awaitable<ReturnType<typeof listPosts>>;
  listPostModerationQueue: (filters?: Parameters<typeof listPostModerationQueue>[0]) => Awaitable<ReturnType<typeof listPostModerationQueue>>;
  moderatePost: (input: Parameters<typeof moderatePost>[0]) => Awaitable<ReturnType<typeof moderatePost>>;
};

const demoStore: SilsiganStore = {
  createPost,
  flagPost,
  listHashtags,
  listPosts,
  listPostModerationQueue,
  moderatePost,
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
