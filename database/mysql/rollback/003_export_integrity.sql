-- Rollback only objects introduced by 003_export_integrity.sql.
-- Restores 001 single-column FKs. Never drops 001/002 business columns.

DROP TABLE IF EXISTS member_mutation_idempotency;
DROP TABLE IF EXISTS member_export_tickets;

ALTER TABLE member_refunds
  DROP FOREIGN KEY member_refunds_order_app_fk,
  ADD CONSTRAINT member_refunds_order_fk
    FOREIGN KEY (order_id) REFERENCES member_orders (id) ON DELETE RESTRICT;

ALTER TABLE member_entitlements
  DROP FOREIGN KEY member_entitlements_source_order_app_fk,
  ADD CONSTRAINT member_entitlements_source_order_fk
    FOREIGN KEY (source_order_id) REFERENCES member_orders (id) ON DELETE RESTRICT;

ALTER TABLE member_registrations
  DROP FOREIGN KEY member_registrations_event_app_fk,
  DROP FOREIGN KEY member_registrations_order_app_fk,
  ADD CONSTRAINT member_registrations_event_fk
    FOREIGN KEY (event_id) REFERENCES member_events (id) ON DELETE RESTRICT,
  ADD CONSTRAINT member_registrations_order_fk
    FOREIGN KEY (source_order_id) REFERENCES member_orders (id) ON DELETE RESTRICT;

ALTER TABLE member_events
  DROP FOREIGN KEY member_events_cover_app_fk,
  ADD CONSTRAINT member_events_cover_fk
    FOREIGN KEY (cover_asset_id) REFERENCES member_media_assets (id) ON DELETE SET NULL;

ALTER TABLE member_profiles
  DROP FOREIGN KEY member_profiles_avatar_app_fk,
  ADD CONSTRAINT member_profiles_avatar_fk
    FOREIGN KEY (avatar_asset_id) REFERENCES member_media_assets (id) ON DELETE SET NULL;

ALTER TABLE member_registrations
  DROP INDEX member_registrations_app_id_uk;

ALTER TABLE member_orders
  DROP INDEX member_orders_app_id_uk;

ALTER TABLE member_events
  DROP INDEX member_events_app_id_uk;

ALTER TABLE member_media_assets
  DROP INDEX member_media_assets_app_id_uk;
