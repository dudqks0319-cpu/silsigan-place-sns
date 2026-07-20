# #실시간 Capacitor WebView shell

This package wraps the deployed Next/Cloudflare app and contains generated iOS and Android Capacitor project skeletons under `ios/` and `android/`.

Set `SILSIGAN_WEBVIEW_ENV` to `staging` or `production`, then set the matching existing Pages variable:

- `SILSIGAN_STAGING_PAGES_URL`
- `SILSIGAN_PRODUCTION_PAGES_URL`

Both configuration validation and Capacitor config loading fail closed when the selected URL is missing, non-HTTPS, local, or contains credentials. `SILSIGAN_WEBVIEW_FIRST_PARTY_ORIGINS` may contain a comma-separated list of exact HTTPS origins; it defaults to the selected Pages origin and must include that origin.

The deployed Next app mounts `NativeBridgeBootstrap`, creates `createWebViewBridge(...)`, installs its document navigation guard, and registers the returned lifecycle seams only when Capacitor reports a native platform. Links outside the exact first-party origin set are opened with Capacitor Browser. The location verifier may receive native coordinates internally, but only `distanceBucket` and `accuracyBucket` cross back into the web payload.

The bridge is exposed as `window.SilsiganNativeBridge` after native startup. `SilsiganShell.openSettings` is implemented in the generated iOS and Android app targets and opens the app's system settings page for the requested permission recovery flow. A signed staging build and real-device QA are still required to verify the adapter on hardware.

## Android local verification

Capacitor Camera's Kotlin toolchain requires JDK 21. On this workspace, macOS does not discover the Homebrew JDK through `/usr/libexec/java_home`, so keep the override scoped to the build command instead of changing or committing a machine-wide Java path:

```bash
cd apps/webview/android
env JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew :app:lintDebug :app:assembleDebug --console=plain
```

An APK build is not real-device evidence. Record installation, permissions, launch, navigation, photo, location, redaction, and crash results in `docs/real-device-qa.md` from an attached emulator or device.

## Native privacy and storage boundaries

- iOS includes `ios/App/App/PrivacyInfo.xcprivacy` in the App target resources with tracking disabled and the current data inventory declared. Final signed archives must still be checked with Xcode's privacy report because bundled SDK behavior can change.
- Android sets `allowBackup=false` and supplies both legacy `backup_rules.xml` and Android 12+ `data_extraction_rules.xml`; cloud backup and device transfer exclude app files, databases, preferences, and external app data.
- Android FileProvider exposes only app-scoped external files and cache. It does not expose the shared external-storage root.
- The release harness checks these native contracts plus `docs/store-privacy-disclosure-draft.md`. Store-console answers and named legal review remain external release evidence.
