export const WEBVIEW_BRIDGE_SCHEMA: "kr.silsigan.webview";
export const WEBVIEW_BRIDGE_VERSION: string;
export const WEBVIEW_BRIDGE_COMMANDS: readonly [
  "requestLocation",
  "takePhoto",
  "selectPhoto",
  "share",
  "openSettings",
  "getAppVersion",
  "registerPushToken",
];

export type DistanceBucket = "within_50m" | "within_150m" | "within_300m" | "outside_300m" | "unverified";
export type AccuracyBucket = "high" | "medium" | "low" | "unknown";
export type LocationWebPayload = Readonly<{ distanceBucket: DistanceBucket; accuracyBucket: AccuracyBucket }>;
export type NativePushPlatform = "ios" | "android";

export function sanitizeLocationResult(
  position: { coords: { latitude: number; longitude: number; accuracy: number } },
  verifyLocation?: (coordinates: { latitude: number; longitude: number; accuracy: number }) => Promise<
    { distanceBucket: DistanceBucket } & Record<string, unknown>
  >,
): Promise<LocationWebPayload>;

export function createWebViewBridge(options?: {
  firstPartyOrigins?: readonly string[];
  isNative?: boolean;
  loadPlugin?: (specifier: string) => Promise<Record<string, unknown>>;
  nativePlatform?: NativePushPlatform;
  verifyLocation?: Parameters<typeof sanitizeLocationResult>[1];
  openSettings?: (section: "app" | "location" | "camera" | "notifications") => Promise<unknown>;
  registerPushToken?: (registration: { platform: "ios" | "android"; token: string }) => Promise<unknown>;
  openWindow?: (url: string, target: string, features: string) => unknown;
  fetch?: typeof globalThis.fetch;
}): Readonly<{
  schema: typeof WEBVIEW_BRIDGE_SCHEMA;
  version: string;
  platform: NativePushPlatform | null;
  commands: typeof WEBVIEW_BRIDGE_COMMANDS;
  invoke(input: unknown): Promise<{
    schema: string;
    version: string;
    requestId: string;
    ok: boolean;
    value?: unknown;
    error?: { code: string; message: string };
  }>;
  classifyNavigation(url: string): "internal" | "external" | "blocked";
  openExternal(url: string): Promise<{ opened: "system" | "browser" }>;
  requestPushRegistration(): Promise<{ requested: true }>;
  installNativeEventSeams(target?: Window): Promise<() => void>;
  installDocumentNavigationGuard(document?: Document): () => void;
}>;
