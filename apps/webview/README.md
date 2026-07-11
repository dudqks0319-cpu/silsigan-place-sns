# #실시간 Capacitor WebView shell

This package wraps the deployed Next/Cloudflare app. It does not contain generated iOS or Android projects.

Set `SILSIGAN_WEBVIEW_ENV` to `staging` or `production`, then set the matching existing Pages variable:

- `SILSIGAN_STAGING_PAGES_URL`
- `SILSIGAN_PRODUCTION_PAGES_URL`

Both configuration validation and Capacitor config loading fail closed when the selected URL is missing, non-HTTPS, local, or contains credentials. `SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS` may contain a comma-separated list of exact HTTPS origins; it defaults to the selected Pages origin and must include that origin.

The deployed Next app mounts `NativeBridgeBootstrap`, creates `createWebViewBridge(...)`, installs its document navigation guard, and registers the returned lifecycle seams only when Capacitor reports a native platform. Links outside the exact first-party origin set are opened with Capacitor Browser. The location verifier may receive native coordinates internally, but only `distanceBucket` and `accuracyBucket` cross back into the web payload.

The bridge is exposed as `window.SilsiganNativeBridge` after native startup. `SilsiganShell.openSettings` is an explicit custom native adapter seam; native project generation must implement that method before settings recovery can pass real-device QA.
