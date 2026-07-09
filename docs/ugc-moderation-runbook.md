# #실시간 UGC moderation runbook

Updated: 2026-06-26
Scope: TestFlight MVP UGC operations for comments, photos, place reports, and field reports. This runbook does not authorize App Store production submission.

## Ownership

| Role | Owner | Responsibility |
| --- | --- | --- |
| Moderation operator | Product/operator on call | Review reports, hide/restore/delete content, restrict abusive anonymous users, and record evidence. |
| Engineering owner | Worker/API owner | Keep moderation APIs, D1 audit rows, R2 delete/hide paths, cache invalidation, and webhook redaction working. |
| Release owner | PM/operator | Confirm this runbook, `docs/current-release-state.md`, `release-ledger.yaml`, and `RELEASE_STATUS.md` stay aligned before TestFlight expansion. |

No one should process reports from raw Cloudflare logs or unredacted request bodies. Use the moderation queue/API evidence only.

## Intake Queue

Primary intake is the Worker moderation report path:

- User reports are created through `POST /api/moderation/reports`.
- Alert delivery uses the Worker secret `MODERATION_ALERT_WEBHOOK_URL`.
- Optional alert authentication uses `MODERATION_ALERT_WEBHOOK_TOKEN`.
- Alerts must include only report ID, target type, target ID, reason, priority, queue path, environment, and timestamp.
- Alerts must not include reporter ID, anonymous ID, note body, raw coordinate, original filename, token, cookie, Cloudflare account ID, or request body.

Supported report reasons that operators must recognize:

- `privacy_face`
- `privacy_plate`
- `sensitive_info`
- `false_content`
- `spam`
- `other`

Supported moderation targets:

- `place`
- `comment`
- `photo`
- `anonymous_user`

## SLA

| Queue | First response | Final decision | Default handling |
| --- | --- | --- | --- |
| Hospital/government sensitive info | immediate triage | 12h | hide first, then review. |
| Face, plate, document, phone, address, account, resident ID | immediate triage | 24h | hide first, then review. |
| False location, false photo, spam, repeated low-quality reports | same day triage | 72h | leave visible unless obviously harmful, then hide. |
| User restriction appeal or accidental hide | same day triage | 72h | restore if evidence is insufficient. |

If the operator cannot meet the SLA, stop TestFlight expansion and record the miss in `docs/current-release-state.md`.

## Operator Actions

Use the admin operation API or admin screen only with a configured admin token. Admin behavior is deny-by-default.

| Action | When to use | Required follow-up |
| --- | --- | --- |
| `hide` | Sensitive photo/comment/report should disappear before final review. | Confirm public list, detail sheet, ranking, and photo file path no longer expose it. |
| `restore` | Report was incorrect or content was over-hidden. | Confirm content returns to the public surface and cache invalidation ran. |
| `delete` | User deletion request, clearly illegal/sensitive media, or operator final removal. | Confirm D1 state, R2 object, thumbnail, and KV/cache entries are cleaned or blocked. |
| `restrict` | Repeated abuse, spam, false reports, or ranking manipulation. | Confirm public write paths fail without echoing anonymous ID or private details. |

Photo handling:

- For `photo`, prefer `hide` immediately for privacy-face, privacy-plate, document, or sensitive_info reasons.
- Use `delete` only after final decision or explicit deletion request.
- After delete, R2 public/read proxy must not return the image.

Comment handling:

- For `comment`, hide if it includes phone, address, resident ID, account, vehicle plate, script, URL spam, or named private person details.
- Restore only when the comment is safe without edits.

## Evidence And Audit

For each moderation incident, record:

- report ID
- target type and target ID
- action taken: `hide`, `restore`, `delete`, or `restrict`
- decision reason
- operator subject or role
- timestamp
- public-surface check result
- cache/R2 cleanup check result when applicable

Evidence must be redacted before it is added to release notes or artifacts:

- no raw coordinates
- no request bodies
- no original filenames
- no anonymous IDs
- no admin tokens
- no private emails

Local proof already covered by tests:

- admin token is deny-by-default
- moderation role gates hide/restore/delete/restrict actions
- D1 audit records are written
- R2 delete/hide paths are called for photos
- cache invalidation runs for affected public surfaces
- moderation alerts are redacted

## Escalation

Escalate immediately to the release owner and pause TestFlight expansion if any of these occur:

- `MODERATION_ALERT_WEBHOOK_URL` is missing in staging or production.
- Operators cannot access the moderation queue.
- A privacy_face, privacy_plate, or sensitive_info report cannot be hidden.
- R2 delete/block evidence cannot be produced for a deleted photo.
- Public UI still shows hidden/deleted content after cache invalidation.
- Workers tail or smoke artifacts contain raw coordinates, original filenames, anonymous IDs, tokens, or request bodies.

## Stop Conditions

Stop before external TestFlight expansion when:

- no named operator is available for the SLA window
- staging admin token is missing
- alert webhook is missing or unverified
- `comment` and `photo` moderation smoke has not passed
- deletion/restore smoke has not passed
- R2 image block/delete evidence is missing
- redaction smoke fails
