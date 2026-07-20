import { cloudflareApiUrl, fetchJson, isCloudflareApiConfigured } from "./api-client.ts";

export type SilsiganEventName =
  | "view_home"
  | "view_place"
  | "click_place"
  | "click_map_marker"
  | "click_hashtag"
  | "follow_place"
  | "follow_hashtag"
  | "toggle_notifications"
  | "helpful_post"
  | "save_post"
  | "share_post"
  | "share_report"
  | "submit_post"
  | "submit_report"
  | "like_place"
  | "like_comment"
  | "create_comment"
  | "click_photo"
  | "delete_photo"
  | "upload_photo"
  | "upload_place_photo"
  | "report_abuse"
  | "report_vote_agree"
  | "report_vote_changed"
  | "user_blocked"
  | "account_deletion_requested"
  | "submit_quick_report"
  | "request_location"
  | "location_denied"
  | "toggle_traffic_layer"
  | "search_naver_place"
  | "import_naver_place"
  | "place_addition_requested"
  | "answer_field_quest"
  | "flag_post"
  | "moderate_post"
  | "moderate_worker_report"
  | "filter_moderation_queue"
  | "view_challenge"
  | "complete_onboarding"
  | "app_opened"
  | "manual_location_selected"
  | "location_permission_requested"
  | "location_permission_granted"
  | "location_permission_denied"
  | "nearby_loaded"
  | "nearby_load_failed"
  | "map_viewed"
  | "place_opened"
  | "place_deep_link_opened"
  | "live_status_viewed"
  | "report_started"
  | "report_location_verified"
  | "report_location_failed"
  | "report_submitted"
  | "report_approved"
  | "report_rejected"
  | "map_load_succeeded"
  | "map_load_failed"
  | "app_runtime_error"
  | "content_reported"
  | "stream_play_started"
  | "stream_play_failed"
  | "ad_impression";

type EventProperties = Record<string, string | number | boolean | null>;

let analyticsTransportEnabled = true;

export function setAnalyticsTransportEnabled(enabled: boolean) {
  analyticsTransportEnabled = enabled;
}

export function trackEvent(name: SilsiganEventName, properties: Record<string, string | number | boolean | null> = {}) {
  const safeProperties = redactAnalyticsProperties(properties);
  if (process.env.NODE_ENV !== "production") {
    console.info("[silsigan:event]", name, safeProperties);
    return;
  }

  if (analyticsTransportEnabled && isCloudflareApiConfigured()) {
    void fetchJson(cloudflareApiUrl("/api/analytics/events"), {
      method: "POST",
      body: JSON.stringify({ eventName: name, properties: safeProperties }),
    }).catch(() => undefined);
  }
}

export function redactAnalyticsProperties(properties: EventProperties): EventProperties {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, shouldRedactAnalyticsValue(key, value) ? "[redacted]" : value]),
  );
}

function shouldRedactAnalyticsValue(key: string, value: string | number | boolean | null): boolean {
  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey.includes("token") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("authorization") ||
    normalizedKey.includes("cookie") ||
    normalizedKey.includes("password") ||
    normalizedKey.includes("memo") ||
    normalizedKey.includes("comment") ||
    normalizedKey.includes("caption") ||
    normalizedKey.includes("note") ||
    normalizedKey.includes("coordinate") ||
    normalizedKey.includes("latitude") ||
    normalizedKey.includes("longitude") ||
    normalizedKey.includes("clientlocation") ||
    normalizedKey.includes("filename") ||
    normalizedKey.includes("error") ||
    normalizedKey.includes("stack") ||
    normalizedKey.includes("digest") ||
    normalizedKey === "location" ||
    normalizedKey === "anonymousid" ||
    normalizedKey === "anonid" ||
    normalizedKey === "adminsubject"
  ) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  return (
    /^anon_[a-zA-Z0-9_-]{8,}$/.test(value) ||
    /^sk-(?:proj-)?[a-zA-Z0-9_-]{16,}$/.test(value) ||
    /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value) ||
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ||
    /\.(?:jpe?g|png|webp|gif|heic|svg|pdf)$/i.test(value)
  );
}
