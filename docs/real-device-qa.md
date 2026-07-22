# #실시간 real-device QA ledger

Updated: 2026-07-23
Status: staging API/web and private R2 are live. An Apple Development-signed staging build now compiles, installs, and launches on a physical iPhone 12 Pro running iOS 17.6.1; its console reached the exact staging URL and `WebView loaded` without a startup crash during a bounded 12-second observation. Screenshot-backed navigation, permission, camera/library, photo lifecycle, mutation, deletion, and full-session crash evidence remain pending, as do TestFlight release signing and Android real-device QA.

The staging API/R2 statements below supersede the 2026-07-20 `R2_NOT_ENABLED` and API-not-deployed snapshot. Production and real-device evidence remain separate and unchanged.

## Scope

This ledger records the device evidence required before TestFlight internal testing. It does not replace `docs/current-release-state.md`; it is the device-specific proof surface referenced by `docs/testflight-readiness.md`.

## Environment

| Item | Current state |
| --- | --- |
| Staging Pages URL | `https://silsigan-web-staging.dudqks0319.workers.dev`; live API mode reverified |
| Staging Worker API URL | `https://silsigan-api-staging.dudqks0319.workers.dev`; live |
| R2 staging bucket visibility | private bucket `silsigan-photos-staging`; `r2.dev` disabled, no direct custom domain, last reconciled size `0 B`. Human Turnstile upload/moderate/read/delete and zero-residual proof remain pending |
| Staging D1 through `0026` | verified through `0026`; Wrangler pending 0 and boundary/registry/core seed evidence pass |
| Production D1 through `0026` | current read-only classifier returns `D1_0006_NOT_APPLIED`; production apply requires separate approval after clean staging evidence |
| Capacitor native skeleton | local iOS/Android projects, permissions, and `SilsiganShell.openSettings` adapter present |
| Native static checks | `swiftc -parse`, plist/XML validation, WebView check, and mobile shell verify pass |
| Native build prerequisites | Homebrew OpenJDK 21/Android SDK compile successfully. On 2026-07-23 Xcode 26.3 resolved the Capacitor Swift packages and built the arm64 iPhoneOS Debug target with Apple Development automatic signing. `Info.plist`, `PrivacyInfo.xcprivacy`, bundle id `kr.silsigan.mobile`, version `1.0 (1)`, and the exact HTTPS staging URL were inspected before installation. |
| TestFlight build | not selected |
| iOS Simulator evidence | actual staging URL injected; the last clean iPhone 17 / iOS 26.2 Debug build, install, and launch pass is `artifacts/ios-simulator/staging-home.png`. A 2026-07-20 service-only restart did not recover CoreSimulator device-set allocation, so no newer simulator result is claimed. |
| iPhone real-device evidence | iPhone 12 Pro / iOS 17.6.1 recognized as an Xcode destination; signed Debug build, signature validation, install, developer-app inventory, launch, exact staging URL load, network reachability, and `WebView loaded` pass. No device identifier, provisioning identifier, raw token, coordinate, or personal account value is retained in this ledger. Full UI evidence remains partial until iPhone Mirroring is user-unlocked and the matrix below is exercised. |
| Android internal/debug build | actual staging URL injected; 2026-07-20 local debug APK regenerated with JDK 21, while no emulator/real device is attached and release signing, installation, and real-device run remain pending |
| Android local build evidence | 2026-07-20 `:app:lintDebug` and `:app:assembleDebug` pass with packaged backup/device-transfer rules and app-scoped FileProvider; SHA-256 remains `7439ae76464221f4dd26ae1ef7c4b5753b92ea52d49811b8d12244e53c4ae90f` |
| Local account-deletion evidence | 390x844 mock-only browser E2E passed: exact phrase gate, permanent deletion request, zero owned content, new anonymous session, and old proof rejected with 403; screenshot `artifacts/cloudflare-pages-smoke-account-deletion-final/pages-smoke-account-deletion-1784495121454.png` |

## iPhone QA Matrix

| Flow | Required evidence | Result |
| --- | --- | --- |
| App launch | Build number, device model, iOS version, first screen screenshot | real-device build/install/launch pass; first-screen screenshot pending |
| Naver map display | Map or fallback map visible, marker hit-test works | simulator-render-pass; live API/real-device pending |
| Location allow | Permission prompt, current-location marker, no raw coordinate display | blocked-staging |
| Location deny | Region selection remains usable | blocked-staging |
| Place detail | Place marker/ranking item opens detail sheet | blocked-staging |
| Place click | Worker records click and UI remains responsive | blocked-staging |
| Comment create/delete | Comment appears, realtime/polling state updates, delete hides it | blocked-staging |
| Camera and photo library | Camera permission prompt, photo library permission prompt, denied-state recovery | blocked-staging |
| Photo upload/preview | Camera/photo library permission, upload success, preview loads from staging API | blocked-staging |
| Like/unlike | Count/state changes and duplicate action is bounded | blocked-staging |
| Ranking refresh | Nationwide/region/map-bounds TOP 10 updates or cache evidence is recorded | blocked-staging |
| Report/moderation | User report succeeds, admin hide/delete affects public UI | blocked-staging |
| Account/data deletion | Exact confirmation, owned-data purge, new session, old-proof rejection | local-browser-pass; staging/native pending |
| Privacy redaction | No raw coordinate, original filename, token, or anonymous id visible in UI/log sample | blocked-staging |
| Crash check | No crash during the full script | startup-smoke-pass for 12 seconds through `WebView loaded`; full script pending |

## Android QA Matrix

| Flow | Required evidence | Result |
| --- | --- | --- |
| App launch | Build number, device model, Android version, first screen screenshot | blocked-staging |
| Naver map display | Map or fallback map visible, marker hit-test works | blocked-staging |
| Location allow | Permission prompt, current-location marker, no raw coordinate display | blocked-staging |
| Location deny | Region selection remains usable | blocked-staging |
| Back navigation | Back exits sheets/modals predictably without losing app state | blocked-staging |
| Place detail | Place marker/ranking item opens detail sheet | blocked-staging |
| Camera and photo library | Camera permission prompt, photo library permission prompt, denied-state recovery | blocked-staging |
| Photo upload/preview | Camera/photo library permission, upload success, preview loads from staging API | blocked-staging |
| Like/unlike | Count/state changes and duplicate action is bounded | blocked-staging |
| Ranking refresh | Nationwide/region/map-bounds TOP 10 updates or cache evidence is recorded | blocked-staging |
| Report/moderation | User report succeeds, admin hide/delete affects public UI | blocked-staging |
| Account/data deletion | Exact confirmation, owned-data purge, new session, old-proof rejection | local-browser-pass; staging/native pending |
| Crash check | No crash during the full script | blocked-staging |

## Evidence Naming

Store future evidence under `artifacts/real-device-qa/<date>-<platform>-<build>/` with:

- `device-summary.md`
- `screenshots/`
- `network-redacted.json`
- `console-redacted.log`
- `known-issues.md`

Do not store raw tokens, raw coordinates, exact user coordinates, original filenames, unredacted anonymous IDs, private emails, or Cloudflare account identifiers in evidence artifacts.
