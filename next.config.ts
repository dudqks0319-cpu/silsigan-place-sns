import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  outputFileTracingRoot: process.cwd(),
  typedRoutes: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      },
      {
        protocol: "https",
        hostname: "*.r2.dev"
      },
      {
        protocol: "https",
        hostname: "*.cloudflarestorage.com"
      }
    ]
  }
};

export default nextConfig;
