# Public source fallback evidence eval

Updated: 2026-07-20  
Scope: deterministic local evidence only; this does not activate a provider, install a credential, or replace staging evidence.

## Capability evals

- [x] Exercise the real KMA, TourAPI, national parking, national traffic, national CCTV, and Seoul realtime adapters with validated fixtures.
- [x] Seed one successful network result per source and prove the next in-window read is `fresh`.
- [x] Advance beyond the fresh window, simulate a provider outage, and prove bounded cache fallback is `stale` plus `degraded`.
- [x] Advance beyond the stale window, prove the provider error remains a stable code, and prove the public decision is `insufficient` rather than optimistic live data.
- [x] Prove live/periodic adapters expose provider `observedAt` and bounded `expiresAt`, while static adapters never become current-state signals.
- [x] Emit aggregate-only JSON without credentials, request URLs, provider payloads, raw coordinates, or stream fields.

## Regression evals

- [x] Existing public-data gateway and adapter tests pass: 11/11 focused tests.
- [x] The full repository test suite passes: 361/361.
- [x] Lint, typecheck, and `git diff --check` pass.

## Deterministic grader

```bash
pnpm evidence:public-sources
```

The command passes only when all six sources satisfy every capability criterion. Its JSON result must report `ok: true`, `passedSources: 6`, `failedSources: 0`, and `sensitiveHits: []`.

Latest local evidence: `artifacts/public-source-fallback-local/public-source-fallback.json` reports 6 passed sources, 0 failed sources, and no sensitive hits.

## Human and staging boundary

Legal/data-operations approval, real provider credentials, quota checks, live source health, attribution rendering, and staging ingestion remain human/external gates. Local fixtures may prove failure semantics but must never be labeled as live provider evidence.
