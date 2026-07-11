import { classifyNavigation, installNavigationGuard, openExternalNavigation } from "./navigation.mjs";

export const WEBVIEW_BRIDGE_SCHEMA = "kr.silsigan.webview";
export const WEBVIEW_BRIDGE_VERSION = "1.0.0";
export const WEBVIEW_BRIDGE_COMMANDS = Object.freeze([
  "requestLocation",
  "takePhoto",
  "selectPhoto",
  "share",
  "openSettings",
  "getAppVersion",
  "registerPushToken",
]);

const DISTANCE_BUCKETS = new Set(["within_50m", "within_150m", "within_300m", "outside_300m", "unverified"]);
const DEFAULT_PLUGIN_LOADERS = Object.freeze({
  "@capacitor/app": () => import("@capacitor/app"),
  "@capacitor/browser": () => import("@capacitor/browser"),
  "@capacitor/camera": () => import("@capacitor/camera"),
  "@capacitor/geolocation": () => import("@capacitor/geolocation"),
  "@capacitor/keyboard": () => import("@capacitor/keyboard"),
  "@capacitor/network": () => import("@capacitor/network"),
  "@capacitor/push-notifications": () => import("@capacitor/push-notifications"),
  "@capacitor/share": () => import("@capacitor/share"),
});

export function createWebViewBridge(options = {}) {
  const firstPartyOrigins = Object.freeze([...(options.firstPartyOrigins ?? [])]);
  const loadPlugin = options.loadPlugin ?? loadAllowlistedPlugin;
  const isNative = options.isNative ?? Boolean(globalThis.Capacitor?.isNativePlatform?.());

  async function plugin(specifier, exportName) {
    if (!isNative) return null;
    try {
      return (await loadPlugin(specifier))[exportName];
    } catch {
      throw unsupported(`${exportName} native plugin is unavailable`);
    }
  }

  async function invoke(input) {
    const request = validateRequest(input);
    try {
      const value = await execute(request);
      return response(request.requestId, true, value);
    } catch (error) {
      const safeError = toSafeError(error);
      return response(request.requestId, false, undefined, safeError);
    }
  }

  async function execute(request) {
    switch (request.command) {
      case "requestLocation": {
        const position = await getForegroundPosition();
        return sanitizeLocationResult(position, options.verifyLocation);
      }
      case "takePhoto":
        return getPhoto("camera", request.payload.maxBytes);
      case "selectPhoto":
        return getPhoto("library", request.payload.maxBytes);
      case "share":
        return share(request.payload);
      case "openSettings":
        if (!options.openSettings) throw unsupported("Opening app settings requires a native settings adapter");
        await options.openSettings(request.payload.section);
        return { opened: true };
      case "getAppVersion":
        return getAppVersion();
      case "registerPushToken":
        if (!options.registerPushToken) throw unsupported("Push token registration is unavailable");
        await options.registerPushToken({ platform: request.payload.platform, token: request.payload.token });
        return { registered: true };
      default:
        throw unsupported("Bridge command is unsupported");
    }
  }

  async function getForegroundPosition() {
    const Geolocation = await plugin("@capacitor/geolocation", "Geolocation");
    if (Geolocation) {
      const permission = await Geolocation.requestPermissions({ permissions: ["location"] });
      if (permission.location !== "granted" && permission.coarseLocation !== "granted") {
        throw permissionDenied("Foreground location permission was denied");
      }
      return Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 });
    }
    return browserPosition(options.navigator ?? globalThis.navigator);
  }

  async function getPhoto(source, maxBytes) {
    const Camera = await plugin("@capacitor/camera", "Camera");
    if (!Camera) return browserPhoto(source, maxBytes, options.document ?? globalThis.document);
    const cameraPlugin = await loadPlugin("@capacitor/camera");
    const photo = await Camera.getPhoto({
      source: source === "camera" ? cameraPlugin.CameraSource.Camera : cameraPlugin.CameraSource.Photos,
      resultType: cameraPlugin.CameraResultType.Uri,
      quality: 85,
      allowEditing: false,
      saveToGallery: false,
      correctOrientation: true,
    });
    if (!photo.webPath) throw unsupported("Selected photo has no readable URL");
    return checkedPhoto(photo.webPath, photo.format, maxBytes, options.fetch ?? globalThis.fetch);
  }

  async function share(payload) {
    const Share = await plugin("@capacitor/share", "Share");
    if (Share) {
      await Share.share({ url: payload.url, text: payload.text, dialogTitle: WEBVIEW_BRIDGE_SCHEMA });
      return { shared: true };
    }
    const navigator = options.navigator ?? globalThis.navigator;
    if (navigator?.share) {
      await navigator.share({ url: payload.url, text: payload.text });
      return { shared: true };
    }
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText([payload.text, payload.url].filter(Boolean).join("\n"));
      return { shared: false, copied: true };
    }
    throw unsupported("Sharing is unavailable");
  }

  async function getAppVersion() {
    const App = await plugin("@capacitor/app", "App");
    if (!App) return { version: "browser", build: "development" };
    const info = await App.getInfo();
    return { version: info.version, build: info.build };
  }

  async function openExternal(rawUrl) {
    const Browser = await plugin("@capacitor/browser", "Browser");
    return openExternalNavigation(rawUrl, {
      firstPartyOrigins,
      browser: Browser,
      openWindow: options.openWindow,
    });
  }

  async function requestPushRegistration() {
    if (!isNative) throw unsupported("Push notifications are unavailable in browser development");
    const PushNotifications = await plugin("@capacitor/push-notifications", "PushNotifications");
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt") permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") throw permissionDenied("Push notification permission was denied");
    await PushNotifications.register();
    return { requested: true };
  }

  async function installNativeEventSeams(target = globalThis.window) {
    if (!target) return () => {};
    const removers = [];
    const emit = (name, detail) => target.dispatchEvent(new CustomEvent(`silsigan:${name}`, { detail }));

    if (isNative) {
      const App = await plugin("@capacitor/app", "App");
      const Network = await plugin("@capacitor/network", "Network");
      const Keyboard = await plugin("@capacitor/keyboard", "Keyboard");
      const PushNotifications = await plugin("@capacitor/push-notifications", "PushNotifications");
      removers.push(await addListener(App, "backButton", ({ canGoBack }) => emit("android-back", { canGoBack: Boolean(canGoBack) })));
      removers.push(await addListener(App, "appUrlOpen", async ({ url }) => handleAppUrl(url, options.auth, emit)));
      removers.push(await addListener(Network, "networkStatusChange", ({ connected, connectionType }) => emit("network", { connected, connectionType })));
      removers.push(await addListener(Keyboard, "keyboardWillShow", ({ keyboardHeight }) => emit("keyboard", { visible: true, height: keyboardHeight })));
      removers.push(await addListener(Keyboard, "keyboardWillHide", () => emit("keyboard", { visible: false, height: 0 })));
      removers.push(await addListener(PushNotifications, "registration", ({ value }) => emit("push-token", { token: value })));
      removers.push(await addListener(PushNotifications, "registrationError", () => emit("push-error", { code: "REGISTRATION_FAILED" })));
      const status = await Network.getStatus();
      emit("network", { connected: status.connected, connectionType: status.connectionType });
    } else {
      const onNetwork = () => emit("network", { connected: Boolean(target.navigator?.onLine), connectionType: "unknown" });
      target.addEventListener("online", onNetwork);
      target.addEventListener("offline", onNetwork);
      removers.push(() => target.removeEventListener("online", onNetwork));
      removers.push(() => target.removeEventListener("offline", onNetwork));
      onNetwork();
    }

    emit("safe-area", readSafeArea(target));
    return () => removers.forEach((remove) => remove());
  }

  function installDocumentNavigationGuard(document = globalThis.document) {
    if (!document) throw unsupported("Document navigation guard is unavailable");
    return installNavigationGuard({ document, firstPartyOrigins, openExternal });
  }

  return Object.freeze({
    schema: WEBVIEW_BRIDGE_SCHEMA,
    version: WEBVIEW_BRIDGE_VERSION,
    commands: WEBVIEW_BRIDGE_COMMANDS,
    invoke,
    classifyNavigation: (url) => classifyNavigation(url, firstPartyOrigins),
    openExternal,
    requestPushRegistration,
    installNativeEventSeams,
    installDocumentNavigationGuard,
  });
}

async function loadAllowlistedPlugin(specifier) {
  const load = DEFAULT_PLUGIN_LOADERS[specifier];
  if (!load) throw unsupported("Native plugin is not allowlisted");
  return load();
}

export async function sanitizeLocationResult(position, verifyLocation) {
  const accuracyBucket = accuracyToBucket(position?.coords?.accuracy);
  let distanceBucket = "unverified";
  if (verifyLocation) {
    const result = await verifyLocation({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
    if (!DISTANCE_BUCKETS.has(result?.distanceBucket)) throw new Error("Location verifier returned an invalid distance bucket");
    distanceBucket = result.distanceBucket;
  }
  return Object.freeze({ distanceBucket, accuracyBucket });
}

function validateRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Bridge request must be an object");
  requireOnlyKeys(input, ["requestId", "command", "payload"]);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(input.requestId ?? "")) throw new Error("Invalid bridge requestId");
  if (!WEBVIEW_BRIDGE_COMMANDS.includes(input.command) || !input.payload || typeof input.payload !== "object") {
    throw new Error("Invalid bridge request");
  }
  const payload = input.payload;
  if (input.command === "requestLocation") {
    requireOnlyKeys(payload, ["purpose"]);
    requireEnum(payload.purpose, ["field_report", "nearby"]);
  } else if (input.command === "takePhoto" || input.command === "selectPhoto") {
    requireOnlyKeys(payload, ["purpose", "maxBytes"]);
    if (payload.purpose !== "field_report" || !Number.isInteger(payload.maxBytes) || payload.maxBytes < 100_000 || payload.maxBytes > 10_000_000) {
      throw new Error("Invalid photo payload");
    }
  } else if (input.command === "share") {
    requireOnlyKeys(payload, ["url", "text"]);
    requireHttpsUrl(payload.url);
    if (payload.text !== undefined && (typeof payload.text !== "string" || payload.text.length > 500)) throw new Error("Invalid share text");
  } else if (input.command === "openSettings") {
    requireOnlyKeys(payload, ["section"]);
    requireEnum(payload.section, ["app", "location", "camera", "notifications"]);
  } else if (input.command === "getAppVersion") {
    requireOnlyKeys(payload, []);
  } else if (input.command === "registerPushToken") {
    requireOnlyKeys(payload, ["platform", "token"]);
    requireEnum(payload.platform, ["ios", "android"]);
    if (typeof payload.token !== "string" || payload.token.length < 16 || payload.token.length > 512 || !/^[a-zA-Z0-9:_-]+$/.test(payload.token)) {
      throw new Error("Invalid push token");
    }
  }
  return input;
}

function requireOnlyKeys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unexpected bridge field");
}

function requireEnum(value, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error("Invalid bridge enum");
}

function requireHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) throw new Error("Invalid share URL");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid share URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid share URL");
}

function response(requestId, ok, value, error) {
  return Object.freeze({
    schema: WEBVIEW_BRIDGE_SCHEMA,
    version: WEBVIEW_BRIDGE_VERSION,
    requestId,
    ok,
    ...(ok ? { value } : { error }),
  });
}

function browserPosition(navigator) {
  if (!navigator?.geolocation) throw unsupported("Foreground location is unavailable");
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true,
    timeout: 10_000,
    maximumAge: 15_000,
  }));
}

function browserPhoto(source, maxBytes, document) {
  if (!document?.createElement) throw unsupported("Photo selection is unavailable");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    if (source === "camera") input.capture = "environment";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(unsupported("No photo was selected"));
      if (file.size > maxBytes) return reject(Object.assign(new Error("Photo exceeds maxBytes"), { code: "PHOTO_TOO_LARGE" }));
      resolve({ url: URL.createObjectURL(file), format: file.type, bytes: file.size });
    };
    input.click();
  });
}

async function checkedPhoto(url, format, maxBytes, fetch) {
  if (!fetch) throw unsupported("Photo size validation is unavailable");
  const response = await fetch(url);
  const blob = await response.blob();
  if (blob.size > maxBytes) throw Object.assign(new Error("Photo exceeds maxBytes"), { code: "PHOTO_TOO_LARGE" });
  return { url, format: blob.type || format, bytes: blob.size };
}

function accuracyToBucket(value) {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  if (value <= 25) return "high";
  if (value <= 100) return "medium";
  return "low";
}

async function addListener(plugin, eventName, listener) {
  const handle = await plugin.addListener(eventName, listener);
  return () => void handle.remove();
}

async function handleAppUrl(url, auth, emit) {
  if (auth?.isCallback?.(url)) {
    await auth.consumeCallback(url);
    emit("auth", { status: "completed" });
    return;
  }
  const deepLink = parseDeepLink(url);
  if (deepLink) emit("deeplink", deepLink);
}

function parseDeepLink(rawUrl) {
  if (rawUrl.includes("\\") || /(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(rawUrl)) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "silsigan:" || url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.hostname === "home" && (url.pathname === "" || url.pathname === "/")) return { target: "home" };
  const id = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,99}$/.test(id)) return null;
  if (url.hostname === "place" || url.hostname === "report") return { target: url.hostname, id };
  return null;
}

function readSafeArea(target) {
  const viewport = target.visualViewport;
  const top = Math.max(0, viewport?.offsetTop ?? 0);
  const left = Math.max(0, viewport?.offsetLeft ?? 0);
  const bottom = Math.max(0, target.innerHeight - (viewport?.height ?? target.innerHeight) - top);
  const right = Math.max(0, target.innerWidth - (viewport?.width ?? target.innerWidth) - left);
  return { top, right, bottom, left };
}

function permissionDenied(message) {
  return Object.assign(new Error(message), { code: "PERMISSION_DENIED" });
}

function unsupported(message) {
  return Object.assign(new Error(message), { code: "UNSUPPORTED" });
}

function toSafeError(error) {
  const code = typeof error?.code === "string" ? error.code : "BRIDGE_ERROR";
  return { code, message: code === "BRIDGE_ERROR" ? "Native operation failed" : String(error.message ?? code) };
}
