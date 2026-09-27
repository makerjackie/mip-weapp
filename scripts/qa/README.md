# Local demo role QA

`node scripts/qa/demo-role-readback.mjs` reads the six fixed demo accounts from the configured non-production TEST catalog, calls the current identity and task domain/repository code, and writes a private response snapshot plus a public assertion summary under `.tmp/role-qa-20260926/`.

`demo-role-invoke.mjs` exports `invoke({name, data}, role)` for local DevTools interception. It returns the domain data; the caller supplies the usual `{ok:true,data}` transport envelope. Unsupported actions throw explicitly. It must never be imported into the application or deployed functions.

Evidence boundaries:

- The general SQL adapter only sends read-only, app-scoped SELECT queries; writes and transactions fail. Query results are cached for the process lifetime; restart after changing fixtures.
- The explicit exception `demo-notification-read.mjs` permits only demo user 3 inbox read-state changes. It executes the production atomic UPDATE shape through MCP and reads it back; it does not test the production transaction wrapper. Other users are rejected.
- Demo identities are injected **locally**, not linked to WeChat. No database identity or real owner is modified.
- The reusable UI adapter sets phone/agreement readiness in memory. This tests UI states and does not establish phone binding or agreement acceptance.
- `guest` is derived from attended demo user 3, with direct entitlement reads returning empty only in memory. Related SQL subqueries retain actual membership facts; therefore this scenario does not prove every guest privacy filter.
- `renewal` changes expiry in the access snapshot and commerce benefit DTO consistently for UI display. Persisted entitlements are unchanged. It does not test checkout pricing or renewal writes.
- `new-user` projects an incomplete profile; it does not create a registration.
- Growth reads require an existing growth account and suppress the production read's idempotent account-initialization write. Missing badge profiles use the production DTO's default version 1 locally, without creating a row or simulating any award. Other writes remain forbidden except the fixed notification exception above.
- Only `summary.public.json` is intended for sharing. `responses.private.json` includes internal account/asset identifiers and must not be published. Real phone authorization, payment and scan flows still need a device.

## Completing missing fixtures

`node scripts/qa/complete-demo-fixtures.mjs --apply --confirm-env=<exact env> --confirm-staging-demo` creates seven isolated records for visitors, an unpublished opportunity, demo-4 interest in demo-2, and demo-6 attendance attributed to demo-3. It requires the existing READY demo manifest, six active fixed demo actors, a non-production TEST catalog, and non-live payment. It checks every fixed ID before any write and never overwrites collisions. Running again preserves existing owned records.

Use the same command with `--cleanup` instead of `--apply` to delete only its exact IDs and ownership predicates in reverse foreign-key order. These are synthetic fixtures, including the attendance fact; they are not real scan evidence. Demo-4 remains the ordinary non-attendee role. The fixture readback summary is safe to share; private references are not.

Commerce UI reads project the selected demo actor into an in-memory SQL identity relation. This permits membership-benefit rendering without creating a WeChat identity. Renewal auth and checkout still require real-device validation.
