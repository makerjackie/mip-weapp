# MIP opportunities API

This function owns opportunities, referrals, profile interests, cooperation cards, and super cases.

Required deployment configuration:

- `MIP_DB_CONNECTION_URI`: least-privilege MySQL connection for `mip_*` tables only.
- `MIP_ALLOWED_APP_IDS`: comma-separated trusted Mini Program AppIDs.
- `MIP_IDENTITY_PEPPER`: the same identity secret used by `mip-identity-api`.
- `MIP_AGREEMENTS_JSON`: the same current agreement catalog used by `mip-identity-api`. When omitted, both functions use the built-in current defaults.

Creation, editing, publication, unpublication, referral, and interest mutations rebuild full access readiness from app-scoped server facts. Public and owner reads do not require profile completion.
