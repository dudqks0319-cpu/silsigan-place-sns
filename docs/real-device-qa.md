# #실시간 real-device QA ledger

Updated: 2026-07-27
Status: staging API/web and private R2 are live. An Apple Development-signed staging build compiles, installs over the existing app data, and launches on a cable-connected physical iPhone 12 Pro running iOS 26.5.2. The exact HTTPS staging URL loads the live home without a startup crash, and the first-screen screenshot is retained below. The `AppUITests` target previously executed on the physical phone with 3 passes, 1 fail-closed photo-rights skip outside the registered-place radius, and 0 failures; no automated test selected or transmitted a photo. The upload-map fallback layout fix is deployed to staging web version `7f7f8c85-a983-42e4-a40d-c1f49e35cc98`, and the browser post-deploy smoke passed. A fresh iPhone visual rerun is blocked because Xcode recognizes the cable device but has no signed-in Apple account to regenerate the development profiles. TestFlight release signing, the remaining native mutation/deletion matrix, and Android real-device QA also remain pending.

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
| TestFlight build | none selected; read-only App Store Connect searches for `실시간` and `Silsigan` found no app record, and no record/build/submission was created |
| iOS Simulator evidence | actual staging URL injected; a clean iPhone 17 Pro / iOS 26.2 Debug build, install, and launch passed on 2026-07-27. The earlier retained screenshot remains `artifacts/ios-simulator/staging-home.png`. |
| iPhone real-device evidence | Cable-connected iPhone 12 Pro / iOS 26.5.2 recognized as an Xcode destination; signed Debug build, install over the existing app, launch, exact staging URL load, and first-screen capture pass. `AppUITests` executed 4 tests: 3 passed, 1 was skipped outside the registered-place radius, and 0 failed. No photo was selected or transmitted. No device identifier, provisioning identifier, signing-team identifier, raw token, coordinate, or personal account value is retained in this ledger. Evidence: `artifacts/real-device-qa/2026-07-27-ios-build-1/`. |
| Android internal/debug build | actual staging URL injected; 2026-07-20 local debug APK regenerated with JDK 21, while no emulator/real device is attached and release signing, installation, and real-device run remain pending |
| Android local build evidence | 2026-07-20 `:app:lintDebug` and `:app:assembleDebug` pass with packaged backup/device-transfer rules and app-scoped FileProvider; SHA-256 remains `7439ae76464221f4dd26ae1ef7c4b5753b92ea52d49811b8d12244e53c4ae90f` |
| Local account-deletion evidence | 390x844 mock-only browser E2E passed: exact phrase gate, permanent deletion request, zero owned content, new anonymous session, and old proof rejected with 403; screenshot `artifacts/cloudflare-pages-smoke-account-deletion-final/pages-smoke-account-deletion-1784495121454.png` |

## iPhone QA Matrix

| Flow | Required evidence | Result |
| --- | --- | --- |
| App launch | Build number, device model, iOS version, first screen screenshot | pass: version `1.0 (1)`, iPhone 12 Pro / iOS 26.5.2, signed build/install/launch and `screenshots/staging-home.png` |
| Naver map display | Map or fallback map visible, marker hit-test works | upload fallback map rendered on-device but exposed an overlapping-text defect; bounded shared map styles and regression test pass locally, staging redeploy/recheck pending |
| Location allow | Permission prompt, current-location marker, no raw coordinate display | pass: current-location upload entry rendered without manual place picker or raw coordinate display |
| Location deny | Region selection remains usable | blocked-staging |
| Place detail | Place marker/ranking item opens detail sheet | blocked-staging |
| Place click | Worker records click and UI remains responsive | blocked-staging |
| Comment create/delete | Comment appears, realtime/polling state updates, delete hides it | blocked-staging |
| Camera and photo library | Camera permission prompt, photo library permission prompt, denied-state recovery | not exercised; automated photo selection intentionally excluded from this read-only run |
| Photo upload/preview | Camera/photo library permission, upload success, preview loads from staging API | rights-confirmation test skipped fail-closed because the physical device was outside the 300 m registered-place radius; no photo selected or transmitted |
| Like/unlike | Count/state changes and duplicate action is bounded | blocked-staging |
| Ranking refresh | Nationwide/region/map-bounds TOP 10 updates or cache evidence is recorded | blocked-staging |
| Report/moderation | User report succeeds, admin hide/delete affects public UI | blocked-staging |
| Account/data deletion | Exact confirmation, owned-data purge, new session, old-proof rejection | local-browser-pass; staging/native pending |
| Privacy redaction | No raw coordinate, original filename, token, or anonymous id visible in UI/log sample | first-screen evidence contains none; full flow pending |
| Crash check | No crash during the full script | pass for the executed launch, home, primary navigation, and current-location upload-entry automation; remaining mutation matrix pending |

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

## 2026-07-27 iPhone evidence

- Base commit before this QA record: `24717bd75156e17e2f768e68bc6e532d062ad28f`.
- Local source/evidence candidate containing the AppUITests target, selected redacted artifacts, and upload-map fix: `dfb9fe7ff2a086e1c333795b850294d9bd8cf740`.
- Native target: bundle `kr.silsigan.mobile`, version `1.0 (1)`, HTTPS staging server only.
- Build/install/launch: pass with command-line-only automatic development signing. The team value was not persisted into the project.
- App home screenshot: `artifacts/real-device-qa/2026-07-27-ios-build-1/screenshots/staging-home.png`.
- Earlier UI automation authorization screenshot: `artifacts/real-device-qa/2026-07-27-ios-build-1/screenshots/ui-automation-authorization-required.png`; retained as historical evidence, superseded by the successful run below.
- XCUITest coverage: live home, primary tabs, upload entry without a manual place picker, foreground-only location permission, truthful no-nearby-place recovery, and photo selection disabled until rights confirmation.
- XCUITest execution: 4 total, 3 passed, 1 skipped outside the 300 m registered-place radius, 0 failed. The skipped path remained fail-closed and no photo was selected or transmitted. Redacted structured evidence: `artifacts/real-device-qa/2026-07-27-ios-build-1/xcuitest-summary.json`.
- Pre-fix upload-current-location screenshot: `artifacts/real-device-qa/2026-07-27-ios-build-1/screenshots/upload-current-location-before-map-style-fix.png`. It records the overlapping fallback-map text found by the real-device run; it is not post-fix proof.
- Local remediation: both upload-location map wrappers reuse the existing bounded `.realMapFrame` styles with a 190 px mobile height. The UI contract regression, lint, typecheck, production build, and full root suite (`464/464`) pass. Cloudflare staging web version `7f7f8c85-a983-42e4-a40d-c1f49e35cc98` carries the fix and its browser smoke passes at `65/80`; a fresh iPhone screenshot remains required before closing the visual issue.
- Post-deploy rerun preflight: USB/Xcode recognizes one physical iOS destination. The first attempt was stopped before testing because development profiles were unavailable; retry with provisioning updates confirmed that Xcode has no signed-in Apple account. Failed temporary result bundles and raw logs were deleted immediately because they could contain device/signing identifiers. The account-holder login sheet is open, and no credential or 2FA value is retained.
