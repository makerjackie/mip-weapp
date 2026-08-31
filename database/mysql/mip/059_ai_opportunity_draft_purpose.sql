ALTER TABLE mip_ai_drafts
  DROP CHECK mip_ai_drafts_purpose_ck,
  ADD CONSTRAINT mip_ai_drafts_purpose_ck CHECK (
    purpose IN ('PROFILE', 'COOPERATION_CARD', 'SUPER_CASE', 'OPPORTUNITY')
  );
