import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "cloudflare-env.d.ts",
      "worker-configuration.d.ts",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "apps/webview/android/**/build/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
