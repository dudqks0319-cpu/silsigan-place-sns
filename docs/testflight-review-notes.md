# #실시간 TestFlight review notes

Updated: 2026-07-20
Scope: Cloudflare-backed TestFlight MVP evidence. This is not an App Store production submission packet.

## Beta App Description

#실시간 is a TestFlight beta for checking recent field photos and their observation times before visiting a place. Nationwide search and reporting are available, while the map is a supporting discovery surface. Test users can open a place, read or write comments, upload a field photo, like a place, view evidence-based TOP 10 rankings, and report unsafe or inappropriate UGC. The current beta runs against Cloudflare staging so the team can prove Workers, D1, R2, Durable Objects, moderation, and real-device behavior before production submission.

## Reviewer Instructions

Use the staging frontend from `SILSIGAN_STAGING_PAGES_URL` and the staging Worker API from `SILSIGAN_STAGING_API_BASE_URL`. These must be real HTTPS Cloudflare URLs before internal or external TestFlight review evidence is claimed.

Primary review path:

1. Launch the TestFlight build and allow location permission.
2. Confirm the Naver map or fallback map renders a visible current area and place markers.
3. Open a place detail, create a comment, upload a photo, like the place, and confirm rankings update.
4. Submit a report for a place, comment, or photo.
5. Confirm an operator can hide or delete reported UGC and that hidden content no longer appears in the user surface.

Production App Store submission remains blocked until staging mutation smoke, R2/D1/Turnstile evidence, real-device QA, named privacy/legal review, and UGC operation evidence are complete.

## Permissions

The app may ask for location permission to show nearby places and current-location behavior. If location is denied, the app must remain usable through region selection.

The app may ask for camera permission when the user captures a new field photo, and photo library permission when the user selects an existing field photo. Photos must be re-encoded and must not expose original filenames, EXIF GPS, or raw local file paths.

## UGC Moderation

UGC moderation covers comment and photo report intake, place reports, operator hide, restore, delete, and temporary user restriction actions. The moderation runbook is `docs/ugc-moderation-runbook.md`.

Required evidence before broader TestFlight expansion:

- Report queue receives redacted report data.
- Operator hide removes the item from the user surface.
- Operator restore can reverse an accidental hide.
- Operator delete blocks access to removed photo content and confirms R2 cleanup or block evidence.
- Sensitive report reasons such as `privacy_face`, `privacy_plate`, and `sensitive_info` follow the documented SLA.

## Privacy And Support URLs

The final privacy policy URL and support URL are selected as `https://silsigan-web-production.dudqks0319.workers.dev/privacy` and `https://silsigan-web-production.dudqks0319.workers.dev/support`. Both returned HTTP 200 `text/html` on 2026-07-19 and are recorded in `SILSIGAN_PRIVACY_POLICY_URL` and `SILSIGAN_SUPPORT_URL`. Do not replace them with placeholders; named legal review and store-console entry are still required.

The privacy policy must describe anonymous IDs, coarse location behavior, photo processing, UGC reports, moderation actions, retention, and deletion or restriction behavior. The support URL must give testers a path to report bugs, unsafe content, privacy concerns, and account/data deletion questions.

The code-matched App Privacy and Google Play Data Safety inventory is maintained in `docs/store-privacy-disclosure-draft.md`. It is a release-gated draft; App Store Connect/Google Play Console entry, final archive privacy report, named legal review, and real-device verification are still required.

## Staging Evidence

Required staging evidence:

- `pnpm release:status -- --strict` shows the TestFlight review notes gate passing while external blockers remain explicit.
- `pnpm cf:external-state` passes for D1 and Worker dry-runs, and reports no `R2_NOT_ENABLED` blocker after Cloudflare R2 is enabled.
- D1 evidence includes comments, photos, reports, rankings, posts, and questions rows where relevant.
- R2 evidence includes UUID-based object keys, no original filename exposure, and delete/block proof.
- Pages browser smoke proves map loading, current-location allow/deny, place click, detail open, comment, photo upload, like, ranking, report, and hidden-content behavior.
- Real iPhone QA evidence is recorded in `docs/real-device-qa.md`.

## Stop Conditions

Stop TestFlight expansion if any of these are true:

- `SILSIGAN_STAGING_PAGES_URL` or `SILSIGAN_STAGING_API_BASE_URL` is missing or points to a non-HTTPS/non-Cloudflare URL.
- Cloudflare R2, D1, Workers, Durable Objects, or Pages evidence is missing.
- R2 upload, read, hide, delete, or blocked-access proof is missing.
- UGC moderation report handling cannot be operated within the runbook SLA.
- location permission denial makes the app unusable.
- camera or photo library permission failures produce crashes or raw path/filename exposure.
- privacy policy URL or support URL is still a placeholder.
- `SILSIGAN_PRIVACY_POLICY_URL` or `SILSIGAN_SUPPORT_URL` is missing, non-HTTPS, localhost, duplicated, or contains credentials/query/fragment values.
- iPhone real-device smoke has a critical crash or blocks map/detail/comment/photo/like/report flows.
