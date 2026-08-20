# Vendor: activity-domain pure.cjs

Controlled copy of the storage-agnostic activity domain for CloudBase Event Function packaging.

| Field | Value |
| --- | --- |
| Source of truth | `src/shared/activity-domain/pure.cjs` |
| Runtime path | `./pure.cjs` (package-local; never monorepo-relative) |
| Sync rule | Byte-identical to the source of truth |
| Enforced by | `scripts/lib/membership-api-package.mjs` via `verify:source`, `verify:server`, and `cloud:deploy` |

CloudBase uploads only this function directory. Do not require monorepo or workspace paths from `activity-domain-adapter.js`. When `src/shared/activity-domain/pure.cjs` changes, refresh this vendor file in the same change and re-run `pnpm verify:server`.
