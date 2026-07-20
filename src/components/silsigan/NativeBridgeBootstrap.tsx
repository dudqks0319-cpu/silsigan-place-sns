"use client";

import { useEffect } from "react";
import { createWebViewBridge } from "../../../apps/webview/src/bridge.mjs";

const pluginLoaders: Record<string, () => Promise<Record<string, unknown>>> = {
  "@capacitor/app": async () => ({ ...(await import("@capacitor/app")) }),
  "@capacitor/browser": async () => ({ ...(await import("@capacitor/browser")) }),
  "@capacitor/camera": async () => ({ ...(await import("@capacitor/camera")) }),
  "@capacitor/geolocation": async () => ({ ...(await import("@capacitor/geolocation")) }),
  "@capacitor/keyboard": async () => ({ ...(await import("@capacitor/keyboard")) }),
  "@capacitor/network": async () => ({ ...(await import("@capacitor/network")) }),
  "@capacitor/push-notifications": async () => ({ ...(await import("@capacitor/push-notifications")) }),
  "@capacitor/share": async () => ({ ...(await import("@capacitor/share")) }),
};

type NativeBridge = ReturnType<typeof createWebViewBridge>;

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
      Plugins?: {
        SilsiganShell?: {
          openSettings?: (input: { section: string }) => Promise<unknown>;
        };
      };
    };
    SilsiganNativeBridge?: NativeBridge;
  }
}

export function NativeBridgeBootstrap() {
  useEffect(() => {
    if (!window.Capacitor?.isNativePlatform?.()) return;

    const bridge = createWebViewBridge({
      firstPartyOrigins: [window.location.origin],
      isNative: true,
      nativePlatform: window.Capacitor?.getPlatform?.() === "ios"
        ? "ios"
        : window.Capacitor?.getPlatform?.() === "android"
          ? "android"
          : undefined,
      loadPlugin: async (specifier) => {
        const load = pluginLoaders[specifier];
        if (!load) throw unsupported("Native plugin is not allowlisted");
        return load();
      },
      openSettings: async (section) => {
        const nativeSettings = window.Capacitor?.Plugins?.SilsiganShell?.openSettings;
        if (!nativeSettings) throw unsupported("Native app settings adapter is unavailable");
        await nativeSettings({ section });
      },
      registerPushToken: async ({ platform, token }) => {
        window.dispatchEvent(new CustomEvent("silsigan:push-token", {
          detail: { platform, token },
        }));
      },
    });

    window.SilsiganNativeBridge = bridge;
    let disposed = false;
    let removeEvents: () => void = () => undefined;
    const removeNavigation = bridge.installDocumentNavigationGuard(document);
    void bridge.installNativeEventSeams(window).then((remove) => {
      if (disposed) {
        remove();
        return;
      }
      removeEvents = remove;
      window.dispatchEvent(new CustomEvent("silsigan:bridge-ready", {
        detail: { schema: bridge.schema, version: bridge.version, commands: bridge.commands },
      }));
    });

    return () => {
      disposed = true;
      removeNavigation();
      removeEvents();
      if (window.SilsiganNativeBridge === bridge) delete window.SilsiganNativeBridge;
    };
  }, []);

  return null;
}

function unsupported(message: string): Error & { code: "UNSUPPORTED" } {
  return Object.assign(new Error(message), { code: "UNSUPPORTED" as const });
}
