export function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://silsigan.vercel.app").replace(/\/$/, "");
}
