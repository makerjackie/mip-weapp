'use strict'

const { jsonObject } = require('./common')

// Enrich only already-authorized roster members; the caller owns list visibility and blocking.
async function loadPublicPersonDetails(database, appId, userIds) {
  if (!userIds.length) return new Map()
  const { loadPublicBadges } = require('./discovery')
  const [rows, badges, levels] = await Promise.all([
    database.query(
      `SELECT profile.user_id, profile.visibility_json, profile.identity_status, profile.introduction,
              branch.city_name, growth.experience_balance,
              (SELECT tag.label FROM mip_profile_tags selected
               INNER JOIN mip_tags tag ON tag.app_id = selected.app_id AND tag.id = selected.tag_id
                 AND tag.kind = 'INDUSTRY' AND tag.enabled = 1
               WHERE selected.app_id = profile.app_id AND selected.user_id = profile.user_id
                 AND selected.relation = 'PRIMARY_INDUSTRY' ORDER BY tag.id LIMIT 1) AS industry_label
       FROM mip_profiles profile
       INNER JOIN mip_users person ON person.app_id = profile.app_id AND person.id = profile.user_id
       LEFT JOIN mip_growth_accounts growth ON growth.app_id = profile.app_id AND growth.user_id = profile.user_id
       LEFT JOIN mip_city_branches branch ON branch.app_id = person.app_id
         AND branch.id = person.primary_branch_id AND branch.status = 'ACTIVE'
       WHERE profile.app_id = ? AND profile.user_id IN (${userIds.map(() => '?').join(', ')})`,
      [appId, ...userIds],
    ),
    loadPublicBadges(database, appId, userIds),
    database.query(`SELECT id, name, minimum_experience, status FROM mip_growth_levels
      WHERE app_id = ? AND status = 'ACTIVE' ORDER BY minimum_experience, id`, [appId]),
  ])
  return new Map(rows.map((row) => {
    const visible = jsonObject(row.visibility_json)
    return [row.user_id, {
      ...(visible.primaryBranch !== false && row.city_name ? { cityName: row.city_name } : {}),
      ...(visible.industry !== false && row.industry_label ? { industryLabel: row.industry_label } : {}),
      ...(visible.identityStatus !== false && row.identity_status ? { identityStatus: row.identity_status } : {}),
      ...(visible.introduction !== false && row.introduction ? { introduction: row.introduction } : {}),
      ...publicLevel(row.experience_balance, levels),
      badges: (badges.get(row.user_id) || []).map(badge => ({ id: badge.id, name: badge.name, imageUrl: badge.image_url || undefined })),
    }]
  }))
}

// Same ACTIVE, minimum-experience ordering and zero-base requirement as growth levelSnapshot.
// Do not manufacture a level when the user has no growth account or configuration is incomplete.
function publicLevel(experience, levels) {
  if (experience === null || experience === undefined || !Number.isFinite(Number(experience))) return {}
  const active = levels.filter(level => level.status === 'ACTIVE')
    .sort((left, right) => Number(left.minimum_experience) - Number(right.minimum_experience))
  if (!active.length || Number(active[0].minimum_experience) !== 0) return {}
  const index = active.reduce((current, level, position) => Number(level.minimum_experience) <= Number(experience) ? position : current, 0)
  return { level: { number: index + 1, name: active[index].name } }
}

// 邀请人标注（人才/嘉宾卡 footer 右：用户最近一次活动归档）：USER=玩家邀请人
// （visibility 门控），否则 PLATFORM=MIP 平台（文案与兜底头像由组件决定）；
// 无归档返回 undefined。与 mip-events-api 同名实现同口径，两边同步维护（勿单边改）。
function publicHeartInviter(row) {
  if (!row || !row.invitation_source_type) return undefined
  if (row.invitation_source_type !== 'USER') {
    return { sourceType: 'PLATFORM', displayName: 'MIP 平台' }
  }
  const visible = jsonObject(row.inviter_visibility_json)
  return {
    sourceType: 'USER',
    displayName: visible.nickname !== false && row.inviter_nickname ? row.inviter_nickname : 'MIP 用户',
    ...(visible.avatar !== false && row.inviter_avatar_file_id ? { avatarUrl: row.inviter_avatar_file_id } : {}),
  }
}

// 批量取用户的最近邀请归档（每人取 captured_at 最新一条），供人才列表合并。
async function loadHeartInviters(database, appId, userIds) {
  if (!userIds.length) return new Map()
  const rows = await database.query(
    `SELECT attribution.guest_user_id, attribution.source_type AS invitation_source_type,
            inviter_profile.nickname AS inviter_nickname,
            inviter_profile.visibility_json AS inviter_visibility_json,
            inviter_avatar.cloud_file_id AS inviter_avatar_file_id
     FROM mip_event_invitation_attributions attribution
     INNER JOIN (
       SELECT guest_user_id, MAX(captured_at) AS captured_at
       FROM mip_event_invitation_attributions
       WHERE app_id = ? AND guest_user_id IN (${userIds.map(() => '?').join(', ')})
       GROUP BY guest_user_id
     ) latest ON latest.guest_user_id = attribution.guest_user_id
       AND latest.captured_at = attribution.captured_at
     LEFT JOIN mip_profiles inviter_profile
       ON inviter_profile.app_id = attribution.app_id
         AND inviter_profile.user_id = attribution.inviter_user_id
     LEFT JOIN mip_media_assets inviter_avatar
       ON inviter_avatar.app_id = inviter_profile.app_id
         AND inviter_avatar.id = inviter_profile.avatar_asset_id AND inviter_avatar.status = 'READY'
     WHERE attribution.app_id = ? AND attribution.guest_user_id IN (${userIds.map(() => '?').join(', ')})
     ORDER BY attribution.captured_at DESC`,
    [appId, ...userIds, appId, ...userIds],
  )
  // 最新一条胜出：同人同毫秒多条归档时按 captured_at DESC 保留首条。
  const byUser = new Map()
  for (const row of rows) {
    if (!byUser.has(row.guest_user_id)) byUser.set(row.guest_user_id, publicHeartInviter(row))
  }
  return byUser
}

// 公开档案头部的等级徽标：与列表详情同口径，无成长账户或配置不完整时返回 undefined。
async function loadPublicLevel(database, appId, userId) {
  const [accounts, levels] = await Promise.all([
    database.query(
      `SELECT growth.experience_balance
       FROM mip_growth_accounts growth
       WHERE growth.app_id = ? AND growth.user_id = ?`,
      [appId, userId],
    ),
    database.query(`SELECT id, name, minimum_experience, status FROM mip_growth_levels
      WHERE app_id = ? AND status = 'ACTIVE' ORDER BY minimum_experience, id`, [appId]),
  ])
  return publicLevel(accounts[0]?.experience_balance, levels).level
}

module.exports = { loadHeartInviters, loadPublicLevel, loadPublicPersonDetails, publicHeartInviter, publicLevel }
