# #실시간 Capacitor WebView shell

This package wraps the deployed Next/Cloudflare app. The generated `ios/` and `android/` projects are the native delivery surfaces; runtime URL/origin configuration remains environment-specific.

Generate or refresh the native projects without embedding a placeholder deployment URL:

```bash
SILSIGAN_WEBVIEW_GENERATE=1 pnpm exec cap add ios
SILSIGAN_WEBVIEW_GENERATE=1 pnpm exec cap add android
```

Before syncing a real build, select a verified HTTPS deployment:

```bash
pnpm sync:staging
pnpm sync:production
```

The generation-only mode omits `server.url`; it does not relax the runtime fail-closed checks.

Set `SILSIGAN_WEBVIEW_ENV` to `staging` or `production`, then set the matching existing Pages variable:

- `SILSIGAN_STAGING_PAGES_URL`
- `SILSIGAN_PRODUCTION_PAGES_URL`

Both configuration validation and Capacitor config loading fail closed when the selected URL is missing, non-HTTPS, local, or contains credentials. `SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS` may contain a comma-separated list of exact HTTPS origins; it defaults to the selected Pages origin and must include that origin.

The deployed Next app mounts `NativeBridgeBootstrap`, creates `createWebViewBridge(...)`, installs its document navigation guard, and registers the returned lifecycle seams only when Capacitor reports a native platform. Links outside the exact first-party origin set are opened with Capacitor Browser. The location verifier may receive native coordinates internally, but only `distanceBucket` and `accuracyBucket` cross back into the web payload.

The bridge is exposed as `window.SilsiganNativeBridge` after native startup. `SilsiganShell.openSettings` is an explicit custom native adapter seam; native project generation must implement that method before settings recovery can pass real-device QA.

## Android build prerequisite

Capacitor 8 Android plugins request JDK 21. The repository does not silently download a toolchain, so check the selected `JAVA_HOME` before starting a native build:

```bash
pnpm --dir apps/webview android:check
pnpm --dir apps/webview android:build:debug
```

The check fails before Gradle starts when another JDK is selected. This keeps a missing local toolchain separate from an Android source or dependency failure.
