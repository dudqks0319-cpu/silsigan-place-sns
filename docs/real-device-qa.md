# #실시간 real-device QA ledger

Updated: 2026-06-27
Status: blocked until Cloudflare staging URLs and R2 are ready.

Executable gate: `pnpm qa:real-device`

Current expected result: fail. This is intentional until both iPhone and Android rows below have real pass evidence and dated artifact directories under `artifacts/real-device-qa/`.

## Scope

This ledger records the device evidence required before TestFlight internal testing. It does not replace `docs/current-release-state.md`; it is the device-specific proof surface referenced by `docs/testflight-readiness.md`.

## Environment

| Item | Current state |
| --- | --- |
| Staging Pages URL | missing |
| Staging Worker API URL | missing |
| R2 staging bucket visibility | blocked by `R2_NOT_ENABLED` |
| Staging D1 `0002` | applied and verified |
| Production D1 `0002` | applied and verified |
| TestFlight build | not selected |
| Android internal/debug build | not selected |

## iPhone QA Matrix

| Flow | Required evidence | Result |
| --- | --- | --- |
| App launch | Build number, device model, iOS version, first screen screenshot | blocked-staging |
| Naver map display | Map or fallback map visible, marker hit-test works | blocked-staging |
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
| Privacy redaction | No raw coordinate, original filename, token, or anonymous id visible in UI/log sample | blocked-staging |
| Crash check | No crash during the full script | blocked-staging |

## Android QA Matrix

| Flow | Required evidence | Result |
| --- | --- | --- |
| App launch | Build number, device model, Android version, first screen screenshot | blocked-staging |
| Naver map display | Map or fallback map visible, marker hit-test works | blocked-staging |
| Location allow | Permission prompt, current-location marker, no raw coordinate display | blocked-staging |
| Location deny | Region selection remains usable | blocked-staging |
| Back navigation | Back exits sheets/modals predictably without losing app state | blocked-staging |
| Place detail | Place marker/ranking item opens detail sheet | blocked-staging |
| Place click | Worker records click and UI remains responsive | blocked-staging |
| Comment create/delete | Comment appears, realtime/polling state updates, delete hides it | blocked-staging |
| Camera and photo library | Camera permission prompt, photo library permission prompt, denied-state recovery | blocked-staging |
| Photo upload/preview | Camera/photo library permission, upload success, preview loads from staging API | blocked-staging |
| Like/unlike | Count/state changes and duplicate action is bounded | blocked-staging |
| Ranking refresh | Nationwide/region/map-bounds TOP 10 updates or cache evidence is recorded | blocked-staging |
| Report/moderation | User report succeeds, admin hide/delete affects public UI | blocked-staging |
| Privacy redaction | No raw coordinate, original filename, token, or anonymous id visible in UI/log sample | blocked-staging |
| Crash check | No crash during the full script | blocked-staging |

## Evidence Naming

Store future evidence under `artifacts/real-device-qa/<date>-<platform>-<build>/` with:

- `device-summary.md`
- `screenshots/`
- `network-redacted.json`
- `console-redacted.log`
- `known-issues.md`

Do not store raw tokens, raw coordinates, exact user coordinates, original filenames, unredacted anonymous IDs, private emails, or Cloudflare account identifiers in evidence artifacts.
