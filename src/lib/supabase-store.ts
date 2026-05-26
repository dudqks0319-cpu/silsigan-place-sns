import { ApiError } from "./errors.ts";
import type { SilsiganStore } from "./store.ts";

function notReady(): never {
  throw new ApiError(501, "SUPABASE_STORE_NOT_READY", "Supabase store driver is not implemented for this demo build.");
}

export function createSupabaseStore(): SilsiganStore {
  return {
    createPost: notReady,
    flagPost: notReady,
    listHashtags: notReady,
    listPosts: notReady,
  };
}
