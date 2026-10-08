'use strict'

// MIW-52 统一竖版用户卡：心动值列表需要与嘉宾卡同口径的人员公开详情
// （城市/代表行业/身份状态/等级/佩戴勋章）。口径与 mip-opportunities-api 的
// public-person-details.js 保持一致；云函数独立部署，此处按仓库惯例复制实现，
// 两边同步维护（勿单边改字段口径）。

function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    }
    catch {
      return {}
    }
  }
  return {}
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

// 佩戴勋章（slot 顺序），与公开档案/嘉宾卡同口径；只列 ACTIVE 勋章与可用素材。
async function loadPublicBadges(database, appId, userIds) {
  if (!userIds.length) return new Map()
  const rows = await database.query(
    `SELECT equipment.user_id, equipment.slot_no, badge.id, badge.badge_key,
            badge.name, badge.description, badge.icon_name,
            COALESCE(NULLIF(asset.cloud_file_id, ''), badge.image_url) AS image_url,
            badge.placeholder_shape
     FROM mip_user_badge_equipment equipment
     INNER JOIN mip_user_badges award
       ON award.app_id = equipment.app_id AND award.user_id = equipment.user_id
         AND award.badge_id = equipment.badge_id AND award.status = 'ACTIVE'
     INNER JOIN mip_badges badge
       ON badge.app_id = equipment.app_id AND badge.id = equipment.badge_id
         AND badge.status = 'ACTIVE'
     LEFT JOIN mip_media_assets asset
       ON asset.app_id = badge.app_id AND asset.id = badge.image_asset_id
         AND asset.status = 'READY'
     WHERE equipment.app_id = ? AND equipment.user_id IN (${userIds.map(() => '?').join(', ')})
     ORDER BY equipment.user_id, equipment.slot_no`,
    [appId, ...userIds],
  )
  const byUser = new Map()
  for (const row of rows) {
    const current = byUser.get(row.user_id) || []
    current.push(row)
    byUser.set(row.user_id, current)
  }
  return byUser
}

// Enrich only already-authorized list members; the caller owns list visibility and blocking.
async function loadPublicPersonDetails(database, appId, userIds) {
  if (!userIds.length) return new Map()
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

// 邀请人标注（guest 最近一次活动归档）：USER=玩家邀请人（visibility 门控），
// 否则 PLATFORM=MIP 平台（组件/前端决定文案与兜底头像）；无归档返回 undefined。
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

// 批量取 guest 的最近邀请归档（每 guest 取 captured_at/id 最新一条），供 heart 列表合并。
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
  // 最新一条胜出：同 guest 同毫秒多条归档时按 captured_at DESC 保留首条。
  const byGuest = new Map()
  for (const row of rows) {
    if (!byGuest.has(row.guest_user_id)) byGuest.set(row.guest_user_id, publicHeartInviter(row))
  }
  return byGuest
}

module.exports = { loadPublicPersonDetails, loadHeartInviters, publicHeartInviter, publicLevel }
