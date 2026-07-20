# Cloudflare rollback drill eval

Updated: 2026-07-20  
Scope: non-mutating Worker rollback planning and read-only deployment-history evidence. This harness never executes a rollback, deploy, migration, bucket change, or traffic change.

## Capability evals

- [x] Resolve the exact staging or production Worker name from the selected web/API Wrangler configuration.
- [x] Use Wrangler 4.103.0-compatible `deployments list --json` syntax for optional read-only discovery.
- [x] Select only a distinct, previous, single-version 100% deployment as a rollback candidate.
- [x] Produce an operator-only rollback command without `--yes`; require separate approval before any copy/paste execution.
- [x] State explicitly that Worker rollback does not roll back D1, R2, KV, Durable Objects, migrations, or secrets.
- [x] Emit only redacted JSON without author email, annotations, raw Wrangler errors, credentials, or deployment URLs.

## Fail-closed regression evals

- [x] Reject `--apply`, `--execute`, `--rollback`, `--yes`, and other mutating-mode requests before any command runner is invoked.
- [x] Fail when deployment history has fewer than two deployments, the current deployment is split traffic, or no distinct stable previous version exists.
- [x] Keep production clearly marked as requiring an additional production approval even though the harness itself remains read-only.
- [x] Restrict optional evidence output to a project-relative path below `artifacts/`.
- [x] Existing full tests (`361/361`), lint, typecheck, and `git diff --check` pass.

## Deterministic grader

```bash
pnpm test -- tests/cloudflare-rollback-drill.test.ts
```

The fixture grader must prove candidate selection and redaction without contacting Cloudflare. A separate `--check` run may query deployment history but still must report `mutationsPerformed: false` and `rollbackExecutionSupported: false`.

## Human and staging boundary

A real staging rollback remains an external release-operator exercise. It requires a healthy baseline, explicit user approval, an identified forward-recovery version, post-rollback smoke checks, and restoration verification. Production rollback is never authorized by this local eval. Database or object-store recovery requires its own independently reviewed procedure.
