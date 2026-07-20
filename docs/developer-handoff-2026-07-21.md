# Silsigan V2 developer handoff — 2026-07-21

## Start here

- Canonical remote branch: `codex/silsigan-progress-20260710`
- Mac mini integration base: `5055e623c06bba9c6bd584adf92fc3215c7d727c`
- Current integration worktree: `silsigan/.worktrees/silsigan-integrate-5055e62-20260721`
- Current local integration branch: `agent/silsigan-integrate-5055e62-20260721`
- Final candidate SHA: update in `release-ledger.yaml` after the source commit
- Release state: `v2_local_ready_external_blocked`
- Production deploy and remote production D1 migration were not performed.

Do not reset, clean, or copy the primary directory wholesale. `/Users/jyb-m3max/Desktop/codex/silsigan` contains old and user-owned dirty work. Resume from a clean clone/worktree of the canonical remote branch.

## What this integration kept

- Nationwide place discovery and directory fallback
- Current-photo and hashtag flows with sample/operational boundaries
- Next.js web, Capacitor WebView, iOS/Android shells
- D1 migration registry safeguards through the current canonical chain
- R2/API cost protection with authentication, quotas, one-use tickets, idempotency, global budgets, and emergency stop
- Admin moderation, reports, blocks, deletion, and audit seams
- KMA, TourAPI, national parking, ITS traffic/CCTV and Seoul adapter fixtures
- Sites private deployment configuration without committed secrets or old Git history

## New integrated changes

- One shared final photo upload contract: maximum `1 MiB`
- Local photo source/bridge read bound: maximum `12 MiB`
- Client re-encodes JPEG/WebP through bounded quality and dimension steps and refuses a final blob over `1 MiB`
- Server independently rejects payloads over `1 MiB`
- IP-fingerprint daily upload-byte ceiling reduced to `20 MiB`, alongside the existing daily upload count limit
- Root and mobile dependency overrides updated for current `brace-expansion`, `js-yaml`, `shell-quote`, and `tar` advisories
- Boundary tests added for exact `1 MiB`, `1 MiB + 1`, WebView local-source limits, and client final-size enforcement
- Cross-functional remaining-work plan added at `docs/silsigan-v2-master-completion-plan-2026-07-21.md`

Do not weaken the final 1 MiB server limit merely to support large phone photos. The client may read a bounded local source and compress it, but expensive work and object storage start only after the final-size, identity, quota, one-use ticket, and budget checks pass.

## Verification at this handoff

The values below must be reconciled to the final source SHA in `release-ledger.yaml` before push.

- Root tests: 435 passed, 0 failed, 0 skipped
- Mobile tests: 4 passed, 0 failed, 0 skipped
- `pnpm verify`: passed after the final frozen-lockfile install
- `pnpm lint`: passed
- `pnpm typecheck`: passed
- `pnpm build`: passed, Next.js 16.2.6 with 26 generated pages/routes
- OpenNext build, WebView check, and staging/production web/API Wrangler dry-runs: passed
- `pnpm audit:security`: root and mobile no known vulnerabilities
- Secret-pattern scan: 397 source/evidence files scanned, 0 high-confidence secret hits; only `.env.example` is tracked
- `git diff --check`: passed before the source commit

## Current external truth

### Cloudflare

- Wrangler authentication works.
- Staging API/web and production web deployment histories exist.
- Staging D1 is reported through migration `0026` with core seed evidence.
- CLI still reports `R2_NOT_ENABLED`.
- The staging API URL is not currently healthy and returned a browser connection failure in this verification.
- Production API Worker is not deployed.
- Production D1 remains unapplied from the V2 migration boundary.
- Current shell does not contain final staging/production URL and allowed-origin values.

Treat the staging web URL as UI-shell evidence only. It currently shows sample/demo-style place states and is not proof of a connected live backend.

### Sites

- Private Sites version 2 URL exists.
- Chrome currently shows the OpenAI login wall; authenticated application rendering has not been reverified in this handoff.
- Do not treat private Sites deployment as a public production release.

### NAVER Maps

- A create-application form is filled but was not submitted in this handoff.
- Dynamic Map, web origins, Android package, and iOS bundle fields are present.
- Final registration can create an external/billable service and requires the user's action-time confirmation.
- Shared preview hosts are not final owner-domain release evidence.

### Public data providers

- Adapters and fixtures exist locally.
- Current TourAPI browser tab is not evidence of a completed API utilization application.
- KMA, TourAPI, national parking, and ITS credentials/rights/quotas have not been verified as active in staging.
- Never enable a source until rights, attribution, credentials, refresh, TTL, health, and fallback are all recorded.

## User-only or action-time approval gates

The next developer must stop and obtain confirmation immediately before:

- accepting Cloudflare R2 terms or adding/changing a payment method
- submitting the NAVER Maps application or enabling billable overage
- accepting public-data provider terms or making a final utilization application
- buying or adding a domain
- applying a remote production migration
- deploying or promoting production traffic
- submitting TestFlight, App Store, or Play Console forms

Read-only account inspection does not require these mutations and should come first.

## Safe resume commands

```bash
git fetch origin
git switch codex/silsigan-progress-20260710
git pull --ff-only origin codex/silsigan-progress-20260710

pnpm install --frozen-lockfile
pnpm --dir apps/mobile install --frozen-lockfile
pnpm --dir apps/webview install --frozen-lockfile

pnpm audit:security
pnpm verify
pnpm release:status
pnpm cf:external-state
```

`pnpm release:status` is expected to remain externally blocked. That is not a local test failure.

## Continue in this order

1. Confirm final source SHA, clean tree, full verification, secret scan, and remote SHA.
2. Ask the user to complete the OpenAI Sites login if Sites UI proof is needed.
3. Obtain user confirmation at the exact moment before R2 terms/payment activation and NAVER registration.
4. Re-run `pnpm cf:external-state` and verify R2, D1, Worker names, URL/origin bindings.
5. Deploy staging API only after preflight; verify health and public read before any write smoke.
6. Activate one public-data source at a time: rights → key → fixture → staging health → attribution → fallback.
7. Run one bounded staging photo/report/moderation/delete flow and clean up its objects.
8. Run iPhone and Android real-device QA.
9. Complete legal, operations, and store gates.
10. Consider production only when every P0 in the release ledger is closed.

## Security and cost gate

- No secret, raw IP, exact GPS, anonymous proof, private R2 key, or original image URL in public surfaces or logs.
- Server-side authentication and authorization before expensive work.
- Burst, rolling, daily, per-session/user/fingerprint, and global limits.
- Final photo maximum 1 MiB; bound image dimensions, count, queue, concurrency, timeout, and retry.
- Idempotency and one-use signed upload ticket; replay and duplicate work rejection.
- 60% alert, 70% degradation, 80% automatic stop, plus manual emergency stop.
- Fail closed when identity, quota, budget, source rights, or dependency state cannot be verified.
- Application controls are not “operationally complete” until observed in the target environment.

## Important references

- `docs/silsigan-v2-master-completion-plan-2026-07-21.md`
- `RELEASE_STATUS.md`
- `docs/current-release-state.md`
- `release-ledger.yaml`
- `docs/cloudflare-staging-operator-packet.md`
- `docs/cloudflare-cost-usage-runbook.md`
- `docs/real-device-qa.md`
