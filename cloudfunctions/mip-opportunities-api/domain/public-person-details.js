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

module.exports = { loadPublicLevel, loadPublicPersonDetails, publicLevel }
