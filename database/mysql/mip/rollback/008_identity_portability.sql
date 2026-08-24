ALTER TABLE mip_user_identities
  DROP INDEX mip_user_identities_union_uk,
  ADD KEY mip_user_identities_union_idx (
    app_id,
    provider,
    union_identity_key
  );
