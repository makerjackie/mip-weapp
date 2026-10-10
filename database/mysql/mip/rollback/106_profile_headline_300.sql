-- 回退 headline 列宽到 160；若已存在超过 160 字的数据需先人工截断，否则回退会失败。
ALTER TABLE mip_profiles MODIFY `headline` VARCHAR(160) NULL;
