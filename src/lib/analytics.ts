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
  | "submit_post"
  | "submit_report"
  | "like_place"
  | "create_comment"
  | "click_photo"
  | "upload_photo"
  | "upload_place_photo"
  | "report_abuse"
  | "submit_quick_report"
  | "request_location"
  | "location_denied"
  | "toggle_traffic_layer"
  | "search_naver_place"
  | "import_naver_place"
  | "answer_field_quest"
  | "flag_post"
  | "moderate_post"
  | "moderate_worker_report"
  | "filter_moderation_queue"
  | "view_challenge"
  | "complete_onboarding";

type EventProperties = Record<string, string | number | boolean | null>;

export function trackEvent(name: SilsiganEventName, properties: Record<string, string | number | boolean | null> = {}) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[silsigan:event]", name, redactAnalyticsProperties(properties));
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
    normalizedKey.includes("latitude") ||
    normalizedKey.includes("longitude") ||
    normalizedKey.includes("clientlocation") ||
    normalizedKey.includes("filename") ||
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
