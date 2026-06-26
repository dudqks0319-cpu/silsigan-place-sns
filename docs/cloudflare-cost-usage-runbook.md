# #실시간 Cloudflare cost and usage runbook

Updated: 2026-06-26
Scope: Cloudflare-backed TestFlight MVP cost and usage monitoring for staging and production. This runbook does not authorize App Store production submission.

## Ownership

| Role | Owner | Responsibility |
| --- | --- | --- |
| Release owner | PM/operator | Decide whether TestFlight expansion can continue when cost or usage evidence is missing. |
| Cloudflare operator | Infrastructure owner | Review Usage & billing dashboards, configure Billing alerts, and export redacted evidence. |
| Engineering owner | Worker/API owner | Investigate abnormal R2, D1, Workers, Durable Objects, or Cloudflare Images growth. |

No operator should paste account IDs, payment details, invoices, access tokens, or private customer data into release notes.

## Dashboard Checks

Use Cloudflare Dashboard > Manage Account > Usage & billing as the primary source. Check these products separately:

- Workers: requests, errors, CPU time, subrequest growth, and status-code spikes.
- D1: read queries, write queries, storage, and migration-related growth.
- R2: storage, Class A operations, Class B operations, egress, and object-count growth.
- Durable Objects: requests, duration, and storage if room state starts persisting.
- Cloudflare Images: transformations, stored images, and failed transformations.

Check staging and production separately. Staging evidence must be collected before TestFlight internal testing expands beyond the operator device.

## Baseline Thresholds

Use these TestFlight MVP thresholds until live traffic establishes a better baseline:

| Surface | Staging threshold | Production threshold | Action |
| --- | --- | --- | --- |
| Workers requests | daily increase under 2x the previous daily smoke baseline | daily increase under 2x the previous production baseline | investigate route logs and recent smoke/tester activity. |
| D1 writes | daily writes match expected smoke/tester actions | daily writes match expected tester actions | check abuse, retry loops, and duplicate ranking signals. |
| R2 storage | storage growth matches uploaded photo evidence | storage growth matches accepted user photos | sample object count and verify hidden/deleted photo cleanup. |
| R2 egress | egress stays near preview/read smoke volume | egress stays near real tester view volume | check public photo proxy cache and hotlinked URLs. |
| Cloudflare Images | transformations track uploaded/previewed photos | transformations track photo previews | check duplicate re-encodes and failed transform loops. |
| Durable Objects | room traffic follows active page sessions | room traffic follows active TestFlight sessions | check polling/WebSocket reconnect loops. |

Any unexplained spike above threshold pauses TestFlight expansion until the owner records a cause and mitigation.

## Alert Rules

Configure Billing alerts before external TestFlight expansion:

- One account-level budget alert for the MVP budget ceiling.
- One early warning alert at 50% of budget.
- One stop-work alert at 80% of budget.
- Product-specific alert notes for R2, D1, Workers, Durable Objects, and Cloudflare Images.

Alerts must route to the same operator channel as release blockers, but must not include card details, account ID, invoice links, secrets, request bodies, raw coordinates, anonymous IDs, or original filenames.

## Evidence And Cadence

Record redacted cost and usage evidence on this cadence:

- daily during staging smoke and internal TestFlight week 1
- weekly after usage is stable
- immediately after R2 bucket creation, Worker deploy, Pages deploy, or mutating smoke
- immediately after any privacy, moderation, ranking, photo, or realtime incident

Each evidence entry should include:

- UTC timestamp
- environment: staging or production
- product: R2, D1, Workers, Durable Objects, or Cloudflare Images
- metric name: requests, storage, egress, transformations, reads, writes, errors, or duration
- pass/fail against the baseline threshold
- owner decision: continue, investigate, pause, or stop

## Stop Conditions

Stop before the next TestFlight expansion when:

- Usage & billing cannot be accessed by the operator.
- Billing alerts are not configured.
- R2 storage or egress growth cannot be reconciled to photo smoke or tester activity.
- D1 writes grow faster than expected user actions.
- Workers requests, errors, or CPU indicate a retry loop.
- Durable Objects traffic suggests reconnect loops.
- Cloudflare Images transformations repeat for the same photo without a user action.
- Any cost/usage evidence contains secrets, payment details, raw coordinates, anonymous IDs, original filenames, or request bodies.
