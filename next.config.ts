import type { NextConfig } from "next";
import { stripServerSecretsFromBuildEnv } from "./scripts/build-env-policy.mjs";

// Provider and account credentials are runtime-only. Next loads .env.local
// before evaluating this config, so strip secret-shaped keys before webpack
// can inline them into a deployable server bundle.
stripServerSecretsFromBuildEnv(process.env);
const configuredBuildId = process.env.SILSIGAN_WEB_BUILD_ID?.trim();

const nextConfig: NextConfig = {
  ...(configuredBuildId ? { generateBuildId: async () => configuredBuildId } : {}),
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  outputFileTracingRoot: process.cwd(),
  typedRoutes: true,
  images: {
    // Cloudflare Workers cannot execute sharp's native binaries. Keep image
    // delivery on the original allowlisted origins until a metered Cloudflare
    // Images binding or a custom loader is explicitly enabled.
    unoptimized: true,
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
