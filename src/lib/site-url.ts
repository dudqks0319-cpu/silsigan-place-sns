export function getSiteUrl() {
  if (typeof window !== "undefined" && window.location.origin && window.location.origin !== "null") {
    return window.location.origin.replace(/\/$/, "");
  }

  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://silsigan.pages.dev").replace(/\/$/, "");
}
