# Silsigan V2 developer handoff — 2026-07-20

## Start here

- Canonical branch: `codex/silsigan-progress-20260710`
- Reviewed integration base: `a8e4db0` (`fix: bound retry costs in protected staging`)
- Dependency security commit in this handoff chain: `9daab36` (`fix: audit mobile dependency tree`)
- Turnstile public-config commit: `30360956cd4aad29b145dce664f8bc7943bd5874` (`chore: provision staging Turnstile config`)
- Release state: `v2_local_ready_external_blocked`
- Production deploy and remote D1 migration were not performed.

Always fetch the canonical branch and work from a clean clone or worktree. Do not reset or copy the primary local directory wholesale: `/Users/jyb-m3max/Desktop/codex/silsigan` remains on `010947c` with 241 dirty/untracked status entries that may include user-owned work and generated evidence.

## What was integrated

- The remote nationwide V2 implementation remains canonical: nationwide place discovery, current photos and hashtags, realtime refresh, iOS/Android shells, moderation/admin flows, D1 migration safeguards, and 60/70/80 percent usage-cost protection.
- The later remote retry-cost fix is preserved. Idempotent place-request replays and per-session limit failures stay bounded and do not increment the global mutation counter.
- Mobile dependencies were patched and locked. Root and mobile vulnerability audits now run together through `pnpm audit:security` and are required by CI.
- Expo is pinned to the compatible `~54.0.36` patch line; Expo Doctor passes all 17 checks.

## Intentionally not copied from the dirty primary worktree

- Local alternative migrations `workers/api/migrations/0007_*` through `0012_*`: the canonical remote chain already extends through `0026`; copying these would create numbering/schema conflicts with the verified remote chain.
- Duplicate or partial UI/backend variants such as separate `FieldReportQueueClient`, `SourceHealthPanel`, place-share pages, region/media contracts, and ingestion-target helpers: equivalent or more integrated behavior already exists remotely. Re-evaluate these as isolated P1 proposals, not as a bulk merge.
- `.debug-journal.md`, screenshots, browser logs, generated artifacts, and generated validator output: evidence remains local and is intentionally not shipped as product source.

## Verified at handoff

- current working test set: 428/428 passed, 0 skipped.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm build`: passed, 26 routes generated.
- `pnpm cf:build`: passed; `.open-next/worker.js` generated.
- `pnpm --dir apps/mobile verify`: 4/4 passed.
- `pnpm --dir apps/mobile exec expo-doctor`: 17/17 passed.
- `pnpm audit:security`: root and mobile report no known vulnerabilities.
- Secret-pattern scan and `git diff --check`: passed.

## GitHub Actions state

- The repository Actions permission is enabled with `allowed_actions=all`, and the canonical branch contains `.github/workflows/ci.yml`.
- Runs `29710281873`, `29710857132`, and `29711040447` ended as `startup_failure` with zero jobs and the synthetic workflow path `BuildFailed`; they did not execute repository tests.
- The run page classifies this as an unexpected GitHub error and provides support request ID `26A3:1D8F6:DC98B8:11ECDBC:6A5D7984`. At the same time, [GitHub Status](https://www.githubstatus.com/) reports an active Actions incident in which new workflows may be delayed or fail to start.
- Therefore current local `428/428` evidence is verified, but a green GitHub CI run is not claimed. After GitHub marks the incident resolved, rerun CI without changing the workflow. If startup failure persists, send the request ID above to GitHub Support.
- Do not weaken or remove the CI audit/verification steps merely to produce a green badge.

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
pnpm cf:build
pnpm release:status
```

`pnpm release:status` is expected to remain `blocked-external` until the following provider and device evidence is complete. A blocked result is not a local code failure.

## Next external gates, in order

1. Read-only Cloudflare state check: confirm whether R2 is actually enabled in Wrangler/CLI and that direct public `r2.dev` and R2 custom domains are disabled.
2. Preserve the protected pre-change Staging backup and the empty archived legacy table. Backup-gated recovery preserved the old table and normal Wrangler migrations applied `0018`~`0026`; the latest read-only evidence verifies no pending migration, aligned registry, and core seed evidence with zero remote writes from the verification. Do not add or rewrite migration registry rows.
3. Dedicated `COST_GUARD_STATE` KV is provisioned for staging/production. The exact-host Turnstile widget/public key and both staging secret names are provisioned without committing values. R2 enablement, configured application deployment, and live upload-ticket success/failure evidence remain.
4. Open the existing NAVER Cloud `Silsigan` Dynamic Map application. The approved daily/monthly hard limits and 70% alerts are already saved; now verify the representative account, add an actual notification recipient, replace preview `workers.dev` origins with an owner-controlled domain and exact HTTPS origins, and capture valid-origin success plus invalid-origin rejection. Shared `workers.dev`, `pages.dev`, and `vercel.app` origins are not acceptable release evidence.
5. Deploy the staging API Worker only after preflight passes. Run read-only smoke first, then separately authorize write smoke.
6. Complete private R2 upload/read/delete evidence, moderation smoke, iPhone and Android real-device QA, source-rights review, and legal/store sign-off.
7. Promote to production only after every release-ledger P0 blocker is closed and rollback evidence is current.

## Important references

- `RELEASE_STATUS.md` — concise current gate summary.
- `docs/current-release-state.md` — detailed local, external, device, and legal truth surfaces.
- `release-ledger.yaml` — machine-checked release blockers.
- `docs/cloudflare-staging-operator-packet.md` — staging operator procedure.
- `docs/cloudflare-cost-usage-runbook.md` — cost guard and emergency-stop operations.
- `docs/real-device-qa.md` — required device evidence.

## Safety rules for the next developer

- Never expose API secrets, raw IP addresses, exact user GPS, anonymous proofs, private R2 object keys, or original image URLs.
- Do not weaken per-user/IP/session/global quotas, one-use upload tickets, idempotency, replay protection, request-size bounds, bounded retries, circuit breakers, or 60/70/80 percent kill switches.
- Do not enable demo data in production or treat missing/expired data as quiet, available, or current.
- Do not deploy production, apply remote migrations, purchase a domain/service, accept provider terms, or enable a billable resource without explicit user approval.
