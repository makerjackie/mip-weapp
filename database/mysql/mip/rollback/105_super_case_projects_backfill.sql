-- 撤销超级案例 projects 存量回填：projects 恢复为 NULL，回到迁移前的旧平铺格式状态。
UPDATE mip_super_cases SET projects = NULL WHERE projects IS NOT NULL;
