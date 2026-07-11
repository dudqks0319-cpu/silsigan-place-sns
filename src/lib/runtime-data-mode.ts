import { ApiError } from "./errors.ts";

export type RuntimeDataMode = "live" | "demo";

export function assertLocalDemoApiAvailable(environment = process.env.NODE_ENV) {
  if (environment === "production") {
    throw new ApiError(
      503,
      "LIVE_BACKEND_REQUIRED",
      "운영 환경에서는 Cloudflare Workers 실시간 API만 사용할 수 있습니다.",
    );
  }
}

export function isRuntimeDataModeAllowed(environment: string | undefined, dataMode: RuntimeDataMode) {
  return environment !== "production" || dataMode === "live";
}

export function shouldClearTruthBearingDataOnLoadFailure(environment: string | undefined) {
  return environment === "production";
}
