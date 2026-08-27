# MIP identity API

This function owns trusted WeChat identity resolution, agreement acceptance, encrypted phone binding, the current user's profile, city-branch selection, and caller capability projection.

Required deployment configuration:

- `MIP_DB_CONNECTION_URI`: least-privilege MySQL connection for `mip_*` tables only.
- `MIP_ALLOWED_APP_IDS`: comma-separated trusted Mini Program AppIDs.
- `MIP_IDENTITY_PEPPER`: at least 32 characters; used to derive the stored identity key.
- `MIP_PHONE_ENCRYPTION_KEY`: at least 32 characters; used to derive separate phone lookup, phone encryption, and card-contact encryption keys.
- `MIP_AGREEMENTS_JSON`: optional agreement key, label, version, and internal document path array.

`getAccessSnapshot` reads `mip_membership_entitlements`. Until that migration exists, it returns `membership.source=UNAVAILABLE` and keeps the user as `GUEST`; it never grants player access from a client field.

The function has no timer trigger. `bindWechatPhone` requires the `phonenumber.getPhoneNumber` OpenAPI permission and must be accepted on a real WeChat device.
