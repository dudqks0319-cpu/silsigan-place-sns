export type SilsiganEventName =
  | "view_home"
  | "view_place"
  | "click_map_marker"
  | "click_hashtag"
  | "follow_place"
  | "follow_hashtag"
  | "helpful_post"
  | "save_post"
  | "share_post"
  | "submit_post"
  | "submit_quick_report"
  | "request_location"
  | "location_denied"
  | "toggle_traffic_layer"
  | "search_naver_place"
  | "import_naver_place"
  | "answer_field_quest"
  | "flag_post"
  | "moderate_post"
  | "view_challenge"
  | "complete_onboarding";

export function trackEvent(name: SilsiganEventName, properties: Record<string, string | number | boolean | null> = {}) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[silsigan:event]", name, properties);
  }
}
