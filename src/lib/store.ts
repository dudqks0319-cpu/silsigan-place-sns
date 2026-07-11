import { ApiError } from "./errors.ts";
import {
  createPost,
  flagPost,
  listPostModerationQueue,
  listHashtags,
  listPosts,
  listRegionActivationDashboard,
  moderatePost,
} from "./mock-store.ts";

type Awaitable<T> = T | Promise<T>;

export type SilsiganStore = {
  createPost: (input: Parameters<typeof createPost>[0]) => Awaitable<ReturnType<typeof createPost>>;
  flagPost: (input: Parameters<typeof flagPost>[0]) => Awaitable<ReturnType<typeof flagPost>>;
  listHashtags: () => Awaitable<ReturnType<typeof listHashtags>>;
  listPosts: (filters?: Parameters<typeof listPosts>[0]) => Awaitable<ReturnType<typeof listPosts>>;
  listPostModerationQueue: (filters?: Parameters<typeof listPostModerationQueue>[0]) => Awaitable<ReturnType<typeof listPostModerationQueue>>;
  listRegionActivationDashboard: () => Awaitable<ReturnType<typeof listRegionActivationDashboard>>;
  moderatePost: (input: Parameters<typeof moderatePost>[0]) => Awaitable<ReturnType<typeof moderatePost>>;
};

const demoStore: SilsiganStore = {
  createPost,
  flagPost,
  listHashtags,
  listPosts,
  listPostModerationQueue,
  listRegionActivationDashboard,
  moderatePost,
};

function liveBackendRequired(): never {
  throw new ApiError(
    503,
    "LIVE_BACKEND_REQUIRED",
    "운영 환경에서는 Cloudflare Workers 실시간 API만 사용할 수 있습니다.",
  );
}

const failClosedStore: SilsiganStore = {
  createPost: liveBackendRequired,
  flagPost: liveBackendRequired,
  listHashtags: liveBackendRequired,
  listPosts: liveBackendRequired,
  listPostModerationQueue: liveBackendRequired,
  listRegionActivationDashboard: liveBackendRequired,
  moderatePost: liveBackendRequired,
};

export function getStore(
  driver = process.env.SILSIGAN_STORE_DRIVER ?? "demo",
  environment = process.env.NODE_ENV,
): SilsiganStore {
  if (environment === "production") {
    return failClosedStore;
  }

  if (driver === "demo" || driver === "mock") {
    return demoStore;
  }

  if (driver === "cloudflare") {
    throw new ApiError(
      501,
      "CLOUDFLARE_WORKER_REQUIRED",
      "Cloudflare 모드는 Next.js 서버 저장소 드라이버가 아니라 Workers API 배포를 통해 사용합니다.",
    );
  }

  if (driver === "supabase") {
    throw new ApiError(410, "SUPABASE_REMOVED", "Supabase 저장소 드라이버는 Cloudflare 전환으로 제거되었습니다.");
  }

  throw new ApiError(500, "UNKNOWN_STORE_DRIVER", "알 수 없는 저장소 드라이버입니다.");
}

export const store = getStore();
