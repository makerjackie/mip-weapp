'use strict'

// Canonical policy, vendored into independent bundles and checked for parity.
// Only the five fields in the profile-completion form are mandatory. Gender is optional.
function missingProfileFields(profile = {}) {
  const missing = []
  if (!String(profile.nickname || '').trim()) missing.push('NICKNAME')
  if (!profile.avatarReady) missing.push('AVATAR')
  if (!profile.industryBound) missing.push('PRIMARY_INDUSTRY')
  if (!String(profile.careerIdentityKey || '').trim()) missing.push('CAREER_IDENTITY')
  if (!String(profile.headline || '').trim()) missing.push('HEADLINE')
  return missing
}

function profileCompleteSql(user = 'u', profile = 'profile') {
  return `(COALESCE(TRIM(${profile}.nickname), '') <> ''
    AND COALESCE(TRIM(${profile}.career_identity_key), '') <> ''
    AND COALESCE(TRIM(${profile}.headline), '') <> ''
    AND EXISTS (SELECT 1 FROM mip_media_assets profile_avatar
      WHERE profile_avatar.app_id = ${user}.app_id AND profile_avatar.id = ${profile}.avatar_asset_id
        AND profile_avatar.status = 'READY' AND profile_avatar.purpose = 'AVATAR')
    AND EXISTS (SELECT 1 FROM mip_profile_tags profile_industry
      INNER JOIN mip_tags profile_industry_tag ON profile_industry_tag.app_id = profile_industry.app_id
        AND profile_industry_tag.id = profile_industry.tag_id AND profile_industry_tag.kind = 'INDUSTRY'
      WHERE profile_industry.app_id = ${user}.app_id AND profile_industry.user_id = ${user}.id
        AND profile_industry.relation = 'PRIMARY_INDUSTRY'))`
}

module.exports = { missingProfileFields, profileCompleteSql }
