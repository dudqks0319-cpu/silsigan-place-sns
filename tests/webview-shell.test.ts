import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyWebViewNavigation,
  webViewBridgeCommands,
} from "../packages/contracts/src/webview.ts";
import {
  WEBVIEW_BRIDGE_COMMANDS,
  WEBVIEW_BRIDGE_SCHEMA,
  WEBVIEW_BRIDGE_VERSION,
  createWebViewBridge,
  sanitizeLocationResult,
} from "../apps/webview/src/bridge.mjs";
import { createCapacitorConfig } from "../apps/webview/src/config.ts";
import { classifyNavigation, openExternalNavigation } from "../apps/webview/src/navigation.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("Capacitor WebView shell keeps the production app identity and no generated native projects", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../apps/webview/package.json", import.meta.url), "utf8"));
  const config = createCapacitorConfig({
    SILSIGAN_WEBVIEW_ENV: "production",
    SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.example.com",
  });

  assert.equal(config.appId, "kr.silsigan.mobile");
  assert.equal(config.appName, "#실시간");
  assert.equal(config.server.cleartext, false);
  assert.equal(packageJson.dependencies["@capacitor/core"], "8.4.0");
  assert.equal(existsSync(`${repoRoot}/apps/webview/ios`), false);
  assert.equal(existsSync(`${repoRoot}/apps/webview/android`), false);
});

test("WebView config fails closed without a selected non-local HTTPS deployment", () => {
  assert.throws(() => createCapacitorConfig({}), /SILSIGAN_WEBVIEW_ENV/);
  assert.throws(() => createCapacitorConfig({ SILSIGAN_WEBVIEW_ENV: "staging" }), /SILSIGAN_STAGING_PAGES_URL/);
  assert.throws(() => createCapacitorConfig({
    SILSIGAN_WEBVIEW_ENV: "staging",
    SILSIGAN_STAGING_PAGES_URL: "http://staging.silsigan.example.com",
  }), /non-local HTTPS/);
  assert.throws(() => createCapacitorConfig({
    SILSIGAN_WEBVIEW_ENV: "production",
    SILSIGAN_PRODUCTION_PAGES_URL: "https://localhost:3000",
  }), /non-local HTTPS/);
});

test("WebView config requires an exact first-party origin set containing its deployment", () => {
  const config = createCapacitorConfig({
    SILSIGAN_WEBVIEW_ENV: "staging",
    SILSIGAN_STAGING_PAGES_URL: "https://staging.silsigan.example.com/app",
    SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS: "https://staging.silsigan.example.com,https://auth.silsigan.example.com",
  });

  assert.deepEqual(config.plugins.SilsiganShell.firstPartyOrigins, [
    "https://staging.silsigan.example.com",
    "https://auth.silsigan.example.com",
  ]);
  assert.throws(() => createCapacitorConfig({
    SILSIGAN_WEBVIEW_ENV: "staging",
    SILSIGAN_STAGING_PAGES_URL: "https://staging.silsigan.example.com",
    SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS: "https://staging.silsigan.example.com/app",
  }), /exact origins/);
});

test("shell navigation matches the contract and never treats a sibling or suffix host as first party", () => {
  const origins = ["https://silsigan.example.com"];
  const urls = [
    "https://silsigan.example.com/place/one",
    "https://api.silsigan.example.com/place/one",
    "https://silsigan.example.com.evil.test/place/one",
    "http://silsigan.example.com/place/one",
    "javascript:alert(1)",
  ];

  for (const url of urls) {
    assert.equal(classifyNavigation(url, origins), classifyWebViewNavigation(url, origins));
  }
  assert.equal(classifyNavigation(urls[0]!, origins), "internal");
  assert.equal(classifyNavigation(urls[1]!, origins), "external");
  assert.equal(classifyNavigation(urls[2]!, origins), "external");
});

test("external HTTPS navigation is delegated to the system browser adapter", async () => {
  const opened: string[] = [];
  const result = await openExternalNavigation("https://help.example.com/guide", {
    firstPartyOrigins: ["https://silsigan.example.com"],
    browser: { open: async ({ url }: { url: string }) => { opened.push(url); } },
  });

  assert.deepEqual(opened, ["https://help.example.com/guide"]);
  assert.deepEqual(result, { opened: "system" });
  await assert.rejects(() => openExternalNavigation("https://silsigan.example.com/home", {
    firstPartyOrigins: ["https://silsigan.example.com"],
    browser: { open: async () => undefined },
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UNSUPPORTED");
});

test("location web payload exposes buckets only and strips all raw coordinates", async () => {
  const result = await sanitizeLocationResult({
    coords: { latitude: 35.1532, longitude: 129.1186, accuracy: 18 },
  }, async () => ({ distanceBucket: "within_50m", latitude: 0, longitude: 0 }));

  assert.deepEqual(result, { distanceBucket: "within_50m", accuracyBucket: "high" });
  assert.equal("latitude" in result, false);
  assert.equal("longitude" in result, false);
  assert.equal(JSON.stringify(result).includes("35.1532"), false);
  assert.equal(JSON.stringify(result).includes("129.1186"), false);
});

test("bridge schema version and commands stay aligned with packages/contracts", async () => {
  assert.equal(WEBVIEW_BRIDGE_SCHEMA, "kr.silsigan.webview");
  assert.match(WEBVIEW_BRIDGE_VERSION, /^1\.\d+\.\d+$/);
  assert.deepEqual(WEBVIEW_BRIDGE_COMMANDS, webViewBridgeCommands);

  const bridge = createWebViewBridge({ firstPartyOrigins: ["https://silsigan.example.com"], isNative: false });
  assert.equal(bridge.schema, WEBVIEW_BRIDGE_SCHEMA);
  assert.equal(bridge.version, WEBVIEW_BRIDGE_VERSION);
  const unsupported = await bridge.invoke({
    requestId: "request_1234",
    command: "openSettings",
    payload: { section: "app" },
  });
  assert.deepEqual(unsupported.error, {
    code: "UNSUPPORTED",
    message: "Opening app settings requires a native settings adapter",
  });
});

test("source contract contains no production cleartext or embedded localhost server URL", async () => {
  const source = await readFile(new URL("../apps/webview/capacitor.config.ts", import.meta.url), "utf8");
  const configSource = await readFile(new URL("../apps/webview/src/config.ts", import.meta.url), "utf8");
  assert.equal(source.includes("http://"), false);
  assert.equal(source.includes("localhost"), false);
  assert.equal(configSource.includes("cleartext: true"), false);
  assert.equal(configSource.includes("server: { url: \""), false);
});

test("deployed Next app mounts the native bridge bootstrap with static allowlisted plugin loaders", async () => {
  const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  const bootstrap = await readFile(new URL("../src/components/silsigan/NativeBridgeBootstrap.tsx", import.meta.url), "utf8");

  assert.match(layout, /<NativeBridgeBootstrap\s*\/>/);
  assert.match(bootstrap, /window\.Capacitor\?\.isNativePlatform/);
  assert.match(bootstrap, /window\.SilsiganNativeBridge = bridge/);
  assert.match(bootstrap, /installDocumentNavigationGuard/);
  assert.match(bootstrap, /installNativeEventSeams/);
  for (const plugin of ["app", "browser", "camera", "geolocation", "keyboard", "network", "push-notifications", "share"]) {
    assert.equal(bootstrap.includes(`@capacitor/${plugin}`), true);
  }
  assert.equal(bootstrap.includes("eval("), false);
  assert.equal(bootstrap.includes("javascript:"), false);
});
