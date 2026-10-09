-- 回滚 104:恢复 057 的请求种类与直传路径约束。
-- 只有当不存在 VOICE_STORAGE 请求行时才能执行;恢复后语音直传确认会再次被拒绝。
ALTER TABLE mip_ai_draft_requests
  DROP CHECK mip_ai_draft_requests_kind_ck,
  ADD CONSTRAINT mip_ai_draft_requests_kind_ck CHECK (
    draft_kind IN ('TEXT', 'VOICE_ASSET', 'VOICE_UPLOAD')
  ),
  DROP CHECK mip_ai_draft_requests_upload_ck,
  ADD CONSTRAINT mip_ai_draft_requests_upload_ck CHECK (
    (draft_kind = 'VOICE_UPLOAD' AND audio_asset_id IS NOT NULL AND audio_object_key IS NOT NULL)
    OR (draft_kind <> 'VOICE_UPLOAD' AND audio_object_key IS NULL)
  );
