import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { parseJavaMajor, REQUIRED_ANDROID_JAVA_MAJOR, validateAndroidToolchain } from "../apps/webview/scripts/validate-android-toolchain.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("Capacitor WebView shell keeps the production app identity and generated native projects", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../apps/webview/package.json", import.meta.url), "utf8"));
  const iosAppDelegate = await readFile(new URL("../apps/webview/ios/App/App/AppDelegate.swift", import.meta.url), "utf8");
  const iosInfo = await readFile(new URL("../apps/webview/ios/App/App/Info.plist", import.meta.url), "utf8");
  const androidActivity = await readFile(new URL("../apps/webview/android/app/src/main/java/kr/silsigan/mobile/MainActivity.java", import.meta.url), "utf8");
  const androidPlugin = await readFile(new URL("../apps/webview/android/app/src/main/java/kr/silsigan/mobile/SilsiganShellPlugin.java", import.meta.url), "utf8");
  const androidManifest = await readFile(new URL("../apps/webview/android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const androidFilePaths = await readFile(new URL("../apps/webview/android/app/src/main/res/xml/file_paths.xml", import.meta.url), "utf8");
  const storyboard = await readFile(new URL("../apps/webview/ios/App/App/Base.lproj/Main.storyboard", import.meta.url), "utf8");
  const config = createCapacitorConfig({
    SILSIGAN_WEBVIEW_ENV: "production",
    SILSIGAN_PRODUCTION_PAGES_URL: "https://silsigan.example.com",
  });

  assert.equal(config.appId, "kr.silsigan.mobile");
  assert.equal(config.appName, "#실시간");
  if (!config.server) throw new Error("production config must include a server URL");
  assert.equal(config.server.cleartext, false);
  assert.equal(packageJson.dependencies["@capacitor/core"], "8.4.0");
  assert.equal(existsSync(`${repoRoot}/apps/webview/ios`), true);
  assert.equal(existsSync(`${repoRoot}/apps/webview/android`), true);
  assert.match(iosAppDelegate, /SilsiganShellPlugin/);
  assert.match(iosAppDelegate, /registerPluginInstance/);
  assert.match(iosInfo, /NSCameraUsageDescription/);
  assert.match(iosInfo, /NSLocationWhenInUseUsageDescription/);
  assert.match(iosInfo, /NSPhotoLibraryUsageDescription/);
  assert.match(storyboard, /customClass="SilsiganBridgeViewController"/);
  assert.match(androidActivity, /registerPlugin\(SilsiganShellPlugin\.class\)/);
  assert.match(androidPlugin, /@CapacitorPlugin\(name = "SilsiganShell"\)/);
  assert.match(androidPlugin, /ACTION_APPLICATION_DETAILS_SETTINGS/);
  for (const permission of ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA", "POST_NOTIFICATIONS"]) {
    assert.match(androidManifest, new RegExp(`android\\.permission\\.${permission}`));
  }
  assert.match(androidFilePaths, /<external-files-path name="my_external_files" path="\." \/>/);
  assert.equal(androidFilePaths.includes("<external-path"), false);
});

test("native project generation omits deployment URLs without weakening runtime validation", () => {
  const config = createCapacitorConfig({ SILSIGAN_WEBVIEW_GENERATE: "1" });

  assert.equal(config.appId, "kr.silsigan.mobile");
  assert.equal(config.webDir, "web");
  assert.equal("server" in config, false);
});

test("WebView config validator supports generation mode without weakening runtime mode", () => {
  const validator = fileURLToPath(new URL("../apps/webview/scripts/validate-config.ts", import.meta.url));
  const baseEnv = { ...process.env };
  delete baseEnv.SILSIGAN_WEBVIEW_ENV;
  delete baseEnv.SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS;
  delete baseEnv.SILSIGAN_STAGING_PAGES_URL;
  delete baseEnv.SILSIGAN_PRODUCTION_PAGES_URL;

  const generated = spawnSync(process.execPath, ["--experimental-strip-types", validator], {
    cwd: repoRoot,
    env: { ...baseEnv, SILSIGAN_WEBVIEW_GENERATE: "1" },
    encoding: "utf8",
  });
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(generated.stdout, /webview generation config valid: kr\.silsigan\.mobile/);

  const runtime = spawnSync(process.execPath, ["--experimental-strip-types", validator], {
    cwd: repoRoot,
    env: {
      ...baseEnv,
      SILSIGAN_WEBVIEW_ENV: "staging",
      SILSIGAN_STAGING_PAGES_URL: "https://staging.silsigan.example.com",
    },
    encoding: "utf8",
  });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.match(runtime.stdout, /webview config valid: staging https:\/\/staging\.silsigan\.example\.com\//);
});

test("Android toolchain gate requires the Java version used by Capacitor 8 modules", () => {
  assert.equal(parseJavaMajor('openjdk version "21.0.8" 2025-07-15'), 21);
  assert.equal(parseJavaMajor('openjdk version "1.8.0_442"'), 8);
  assert.equal(parseJavaMajor("not a Java version"), null);
  assert.equal(REQUIRED_ANDROID_JAVA_MAJOR, 21);
  assert.deepEqual(validateAndroidToolchain({ javaExecutable: "/jdk-21/bin/java", javaMajor: 21 }), {
    javaExecutable: "/jdk-21/bin/java",
    javaMajor: 21,
  });
  assert.throws(
    () => validateAndroidToolchain({ javaExecutable: "/jdk-25/bin/java", javaMajor: 25 }),
    /Capacitor 8 Android modules require JDK 21; detected JDK 25/,
  );
});

test("native offline fallback respects safe areas and announces its error state", async () => {
  const fallback = await readFile(new URL("../apps/webview/web/index.html", import.meta.url), "utf8");
  assert.match(fallback, /viewport-fit=cover/);
  assert.match(fallback, /safe-area-inset-top/);
  assert.match(fallback, /role="status"/);
  assert.match(fallback, /네트워크 연결을 확인해 주세요/);
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

  const shellConfig = config.plugins?.SilsiganShell;
  if (!shellConfig) throw new Error("runtime config must include SilsiganShell settings");
  assert.deepEqual(shellConfig.firstPartyOrigins, [
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
