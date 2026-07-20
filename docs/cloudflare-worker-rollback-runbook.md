# Cloudflare Worker rollback runbook

Updated: 2026-07-20  
Owner: release operator  
Scope: Cloudflare web/API Worker versions only. This runbook does not authorize a rollback or any D1, R2, KV, Durable Object, migration, secret, bucket, or traffic mutation.

## Safety boundary

`pnpm cf:rollback:drill` is non-mutating. Its default mode prints a plan, `--check` runs only `wrangler deployments list --json`, and `--history-file` uses a local fixture. The harness deliberately has no execution mode and rejects `--apply`, `--execute`, `--rollback`, `--yes`, and related flags before its command runner is called.

Wrangler Worker rollback replaces Worker code traffic. It does not roll back D1, R2, KV, Durable Objects, migrations, or secrets. An older Worker version may therefore be incompatible with current bindings or data. Resource recovery must be reviewed and executed separately.

## Safe planning commands

Plan only, without Cloudflare access:

```bash
pnpm cf:rollback:drill -- --env=staging --kind=web
pnpm cf:rollback:drill -- --env=staging --kind=api
```

Read-only deployment-history discovery:

```bash
pnpm cf:rollback:drill -- --env=staging --kind=web --check \
  --out=artifacts/cloudflare-rollback-drill/staging-web-readonly.json
```

The result is ready only when the current deployment and one distinct previous deployment each contain exactly one Worker version at 100% traffic. Split traffic, malformed history, a single deployment, and missing Workers fail closed. Output excludes deployment authors, annotations, raw Wrangler errors, credentials, and URLs.

## Current read-only evidence

The 2026-07-20 staging web check identified current version `e87e79d5-5d30-43dc-adfe-1b5393a3b8d2` and distinct previous stable version `d7c2bab9-101f-4d2c-a8c3-0b02e9f6e14e`. Evidence is `artifacts/cloudflare-rollback-drill/staging-web-readonly.json`. No rollback, restore, deploy, migration, or traffic change was performed.

This closes only candidate discovery. The actual staging rollback-and-forward-restoration drill remains pending explicit approval and a healthy API-backed staging environment.

## Actual staging drill gate

Do not begin until every item is true:

- Current and rollback version IDs are recorded by a fresh read-only check.
- Staging health, security headers, read paths, and redaction baseline pass.
- D1 migration compatibility and R2/KV/Durable Object binding compatibility are reviewed.
- Active write tests are stopped, an operator is assigned, and a time window is recorded.
- The user explicitly approves both the rollback and subsequent restoration.
- The forward-restoration version and abort conditions are recorded before rollback.

The release operator then performs the displayed interactive command manually without adding `--yes`. After the rollback, verify health, read paths, security headers, API error behavior, and log redaction. Restore the recorded current version using the separately displayed interactive restoration command and repeat the same checks. Preserve timestamps, version IDs, approvals, smoke summaries, and redacted logs under `artifacts/cloudflare-rollback-drill/`.

## Immediate abort conditions

Abort or restore immediately if any of the following occurs:

- Worker health or critical read paths fail.
- An older Worker expects a missing or incompatible D1 schema or binding.
- Raw coordinates, tokens, emails, original filenames, or provider payloads appear in logs.
- Authentication, authorization, rate limiting, Turnstile, or the R2 80% cost guard weakens.
- The current version cannot be restored cleanly.

Production requires a separate production-specific approval after a successful staging drill. A staging plan or staging rollback never authorizes a production rollback.
