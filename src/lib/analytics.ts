export type SilsiganEventName =
  | "view_home"
  | "view_place"
  | "click_hashtag"
  | "follow_place"
  | "follow_hashtag"
  | "helpful_post"
  | "save_post"
  | "share_post"
  | "submit_post"
  | "request_location"
  | "location_denied"
  | "view_challenge"
  | "complete_onboarding";

export function trackEvent(name: SilsiganEventName, properties: Record<string, string | number | boolean | null> = {}) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[silsigan:event]", name, properties);
  }
}
