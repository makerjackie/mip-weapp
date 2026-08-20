'use strict'

function normalizedText(value, maximumLength, errorCode) {
  if (typeof value !== 'string') throw new Error(errorCode)
  const result = value.trim()
  if (result.length > maximumLength) throw new Error(errorCode)
  return result
}

function normalizeProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_PROFILE')
  }
  const nickname = normalizedText(value.nickname, 20, 'INVALID_NICKNAME')
  if (!nickname) throw new Error('INVALID_NICKNAME')
  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags.map(tag => normalizedText(tag, 12, 'INVALID_TAGS')).filter(Boolean))]
    : []
  if (tags.length > 5) throw new Error('INVALID_TAGS')
  const interests = Array.isArray(value.interests)
    ? [...new Set(value.interests.map(item => normalizedText(item, 20, 'INVALID_INTERESTS')).filter(Boolean))]
    : []
  if (interests.length > 8) throw new Error('INVALID_INTERESTS')
  const skills = Array.isArray(value.skills)
    ? [...new Set(value.skills.map(item => normalizedText(item, 20, 'INVALID_SKILLS')).filter(Boolean))]
    : []
  if (skills.length > 8) throw new Error('INVALID_SKILLS')
  return {
    nickname,
    city: normalizedText(value.city || '', 30, 'INVALID_CITY'),
    headline: normalizedText(value.headline || '', 100, 'INVALID_HEADLINE'),
    bio: normalizedText(value.bio || '', 300, 'INVALID_BIO'),
    organization: normalizedText(value.organization || '', 60, 'INVALID_ORGANIZATION'),
    roleTitle: normalizedText(value.roleTitle || '', 60, 'INVALID_ROLE_TITLE'),
    industry: normalizedText(value.industry || '', 60, 'INVALID_INDUSTRY'),
    tags,
    interests,
    skills,
  }
}

module.exports = { normalizeProfile }
