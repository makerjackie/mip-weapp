ALTER TABLE mip_admin_export_tickets
  DROP CHECK mip_admin_export_tickets_type_ck,
  ADD CONSTRAINT mip_admin_export_tickets_type_ck CHECK (
    export_type IN (
      'USERS', 'EVENT_ROSTER', 'EVENT_ROSTER_ALL', 'EVENT_FEEDBACK', 'EVENT_ORDERS', 'ORDERS',
      'GROWTH_ENTRIES', 'OPPORTUNITIES'
    )
  );
