import type { NextConfig } from "next";

export const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
  },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
] as const;

export const htmlDocumentCacheHeader = {
  key: "Cache-Control",
  value: "public, max-age=0, must-revalidate",
} as const;

export const htmlDocumentRoutes = [
  "/",
  "/privacy",
  "/support",
  "/terms",
  "/place/:path*",
  "/share/:path*",
  "/admin/:path*",
] as const;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  distDir: process.env.SILSIGAN_NEXT_DIST_DIR ?? ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders],
      },
      ...htmlDocumentRoutes.map((source) => ({
        source,
        headers: [htmlDocumentCacheHeader],
      })),
    ];
  },
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  typedRoutes: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  }
};

export default nextConfig;
