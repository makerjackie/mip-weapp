-- 设计稿「一句话介绍你的工作和背景」终审字数上限 300（差异报告 H2，用户拍板），
-- 列宽与两端校验同步放宽：identity-api 保存路径与 admin-api 资料编辑同步改 300。
ALTER TABLE mip_profiles MODIFY `headline` VARCHAR(300) NULL;
