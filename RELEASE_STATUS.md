# Release Status

## 한 줄 상태

V2 로컬 구현은 `184/184` 테스트와 무경고 production build를 통과했지만, 원격 D1 V2 migration, R2, API Worker/URL, NAVER origin 제한, source 권리, 법무·운영 서명, native 실기기 증거가 남아 public release는 `blocked-external`이다.

상세 source of truth는 [docs/current-release-state.md](docs/current-release-state.md), 11개 결정은 [docs/v2-decision-register.md](docs/v2-decision-register.md), 법무·운영 중단 조건은 [docs/v2-legal-operations-gate.md](docs/v2-legal-operations-gate.md)이다.

## 현재 후보

- Version: `0.1.0`
- Build: `not_applicable`
- Base Git SHA: `8198cf745d59895ae28bdd46bc8b32016505308a`
- Branch: `codex/silsigan-progress-20260710`
- Phase: `v2_local_ready_external_blocked`
- Local checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (`184/184`), `pnpm build` pass
- External read-only check: Cloudflare auth and staging/production dry-runs pass; staging/production web Workers have deployment history
- Identity decision: anonymous-first with optional signed member-link seam; external member login remains disabled
- Deferred features: ads, rewards, Q&A, live streams, Seoul realtime, social feed, and demo data remain disabled

## 통과한 증거

- D1 migration chain, V2 TTL/decision/conflict rules, source registry activation policy, public-data adapters, trust-safety identity, account deletion, block/unblock, report votes, photo privacy/moderation, Capacitor bridge/navigation, and release guards pass in the full suite.
- Next.js 16.2.6 production build compiles without warnings and generates all 21 routes.
- `pnpm audit --audit-level critical` reports no known vulnerabilities after the Capacitor dependencies were added.
- 390x844 local browser smoke passes all 31 required interactions; 206 network events store no request body and have no sensitive hits. Home and map evidence is under `artifacts/silsigan-v2-local-report-20260710`.
- Public source credentials and stream URLs are not exposed; CCTV normalization drops playback URLs and treats metadata as static.
- Original photos are not retained; metadata stripping, pixel re-encoding, duplicate rejection, pending moderation, approval/rejection, and deletion paths are covered.
- `ADS_ENABLED=false`, `LIVE_STREAMS_ENABLED=false`, and `SOCIAL_FEED_ENABLED=false` remain launch defaults.

## 막힌 항목

- P0: staging and production D1 are missing V2 migrations: `D1_0006_NOT_APPLIED`.
- P0: Cloudflare R2 is not enabled: `R2_NOT_ENABLED`.
- P0: staging/production API Workers are missing: `WORKER_DEPLOYMENT_MISSING`; selected deployment URLs are absent: `deployment_url.*`.
- P0: NAVER Web Maps console and exact HTTPS origin evidence are missing: `SILSIGAN_NAVER_MAP_WEB_MAPS_CONFIRMED`, `SILSIGAN_NAVER_MAP_ALLOWED_ORIGINS`.
- P0: source-by-source rights, attribution, credentials, health, and audited activation evidence remain in `docs/current-release-state.md`.
- P0: live moderation queue and redacted alert evidence require `MODERATION_ALERT_WEBHOOK_URL`; staging mutation/tail smoke remains incomplete.
- P0: Capacitor native projects, signing, custom settings adapter, staging build, and iPhone/Android real-device evidence remain external.
- P0: named legal and operations reviewers have not signed the location, privacy, UGC, account deletion, source terms, or store disclosure gates.
- P1: final public URLs are not set: `SILSIGAN_PRIVACY_POLICY_URL`, `SILSIGAN_SUPPORT_URL`.

## 다음 행동

1. Review and apply `0004`-`0006` to staging D1 with backup and approval, then verify `D1_0006_NOT_APPLIED` is cleared.
2. Enable R2, deploy the staging API Worker, and select the staging web/API URLs.
3. Confirm NAVER origins and source rights, then run staging ingestion, map/fallback, mutation, admin, R2/Images, and tail-redaction evidence.
4. Generate signed Capacitor builds, complete iPhone/Android QA, and record named legal/operations sign-off.
5. Apply production changes only after staging evidence is clean and separately approved.
