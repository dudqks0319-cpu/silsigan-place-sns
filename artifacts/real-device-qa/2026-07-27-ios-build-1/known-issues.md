# Known issues

1. The real-device upload-current-location view exposed overlapping fallback-map text. The local source now reuses the bounded mobile fallback-map styles and passes its regression test, but the fix is not operationally closed until an explicitly approved Cloudflare staging redeploy and fresh iPhone visual check pass.
2. The fail-closed photo-rights test was skipped because the physical device was outside the 300 m radius of a registered staging place. No photo was selected or transmitted; a within-radius rights-confirmation check remains pending.
3. App Store Connect is at the login screen. Account credentials and two-factor codes must be entered only by the account holder.
4. The current native candidate targets staging. It must not be submitted for public App Store release.
5. Production API/D1/R2 promotion, legal/privacy sign-off, owner-domain evidence, moderation alert delivery, and the staged photo approve/read/delete/zero-residual lifecycle remain release blockers.
6. A same-day online npm vulnerability query is not claimed because transmitting the dependency inventory to npmjs.org requires explicit user authorization.
