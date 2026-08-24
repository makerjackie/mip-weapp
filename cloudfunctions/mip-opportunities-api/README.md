# MIP opportunities API

This function owns opportunities, referrals, profile interests, cooperation cards, super cases, matching requests, and user matching preferences.

Required deployment configuration:

- `MIP_DB_CONNECTION_URI`: least-privilege MySQL connection for `mip_*` tables only.
- `MIP_ALLOWED_APP_IDS`: comma-separated trusted Mini Program AppIDs.
- `MIP_IDENTITY_PEPPER`: the same identity secret used by `mip-identity-api`.
- `MIP_AGREEMENTS_JSON`: the same current agreement catalog used by `mip-identity-api`. When omitted, both functions use the built-in current defaults.
- `MIP_MATCHING_INTERNAL_HMAC_SECRET`: shared only with `mip-admin-api` for signed admin recalculation requests.
- `MIP_MATCHING_REFERENCE_SECRET`: signs request-scoped candidate references returned to clients and the optional provider. It must be at least 32 characters and remain stable for persisted matching requests.
- `MIP_MATCHING_PROVIDER_FUNCTION_NAME`: optional external ranking function. When omitted or unavailable, deterministic local ranking is authoritative.
- `MIP_MATCHING_PROVIDER_TIMEOUT_MS`: optional external provider timeout from 500 to 10000 milliseconds; defaults to 3000.

Creation, editing, publication, unpublication, referral, and interest mutations rebuild full access readiness from app-scoped server facts. Public and owner reads do not require profile completion.

Matching requests use published source opportunities, current user preferences, public cooperation roles/tags, branch scope, privacy visibility, and mutual block facts. Results persist source/settings/result versions and explanations. Clients receive a signed request-scoped `candidateRef` instead of a talent user ID. External ranking receives only `candidateRef`, candidate type, local score, and anonymous signal keys/weights; invalid output and provider failures fall back to local ranking.
