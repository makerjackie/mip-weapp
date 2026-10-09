-- MIW-61 修复语音直传确认全量失败:客户端直传链路(createVoiceDraftStorage)用
-- VOICE_STORAGE 请求种类登记 mip_ai_draft_requests,但 057 的两条 CHECK 只允许
-- TEXT/VOICE_ASSET/VOICE_UPLOAD,并要求非 VOICE_UPLOAD 的 audio_object_key 为 NULL,
-- 于是线上每次语音确认的 INSERT 都被约束拒绝;原始错误不是领域码,客户端只看到
-- 「AI 草稿服务暂时不可用」。本迁移把 VOICE_STORAGE 补进种类约束,并允许它与
-- VOICE_UPLOAD 一样登记 audio_asset_id + audio_object_key,保持孤儿素材清理
-- (draft_kind IN ('VOICE_UPLOAD','VOICE_STORAGE'))复用同一条 lease 查询。
ALTER TABLE mip_ai_draft_requests
  DROP CHECK mip_ai_draft_requests_kind_ck,
  ADD CONSTRAINT mip_ai_draft_requests_kind_ck CHECK (
    draft_kind IN ('TEXT', 'VOICE_ASSET', 'VOICE_UPLOAD', 'VOICE_STORAGE')
  ),
  DROP CHECK mip_ai_draft_requests_upload_ck,
  ADD CONSTRAINT mip_ai_draft_requests_upload_ck CHECK (
    (
      draft_kind IN ('VOICE_UPLOAD', 'VOICE_STORAGE')
      AND audio_asset_id IS NOT NULL
      AND audio_object_key IS NOT NULL
    )
    OR (
      draft_kind NOT IN ('VOICE_UPLOAD', 'VOICE_STORAGE')
      AND audio_object_key IS NULL
    )
  );
