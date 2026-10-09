import type { OpportunityCooperatorInviter, ProfileInterestPage, ProfileInterestPerson, PublicPersonDetails } from './types'
import { MipOpportunityError } from './error'

export function parsePublicPersonDetails(person: Record<string, unknown>): PublicPersonDetails {
  const level = person.level && typeof person.level === 'object' ? person.level as Record<string, unknown> : undefined
  return {
    level: level && Number.isInteger(level.number) && Number(level.number) > 0 && typeof level.name === 'string'
      ? { number: Number(level.number), name: level.name }
      : undefined,
    cityName: typeof person.cityName === 'string' ? person.cityName : undefined,
    industryLabel: typeof person.industryLabel === 'string' ? person.industryLabel : undefined,
    identityStatus: typeof person.identityStatus === 'string' ? person.identityStatus : undefined,
    introduction: typeof person.introduction === 'string' ? person.introduction : undefined,
    badges: Array.isArray(person.badges)
      ? person.badges.flatMap((badge) => {
          if (!badge || typeof badge !== 'object' || typeof badge.id !== 'string' || typeof badge.name !== 'string') {
            return []
          }
          return [{ id: badge.id, name: badge.name, imageUrl: typeof badge.imageUrl === 'string' ? badge.imageUrl : undefined }]
        })
      : [],
  }
}

const invalidResponse = () => new MipOpportunityError('INVALID_RESPONSE', '感兴趣名单返回的数据格式不正确，请稍后重试。', true)

// G3（审计 2026-10-09）：邀请来源标注（figma 2189_43192「邀请人Bear + 头像」）。
// 口径对齐 mip-cooperation responseAuthorInviter：未知键拒绝、畸形整页拒绝；
// 服务端判定 USER/PLATFORM，无归档时服务端省略该字段。
function parseProfileInterestInviter(value: unknown): OpportunityCooperatorInviter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse()
  }
  const source = value as Record<string, unknown>
  if (Object.keys(source).some(key => !['sourceType', 'displayName', 'avatarUrl'].includes(key))
    || !['USER', 'PLATFORM'].includes(String(source.sourceType))
    || typeof source.displayName !== 'string' || !source.displayName.trim() || source.displayName.length > 64
    || !(source.avatarUrl === undefined || typeof source.avatarUrl === 'string')) {
    throw invalidResponse()
  }
  return {
    sourceType: source.sourceType as OpportunityCooperatorInviter['sourceType'],
    displayName: source.displayName,
    ...(source.avatarUrl === undefined ? {} : { avatarUrl: source.avatarUrl }),
  }
}

/** Validate the non-empty roster contract and never forward private server fields. */
export function parseProfileInterests(value: unknown): ProfileInterestPage {
  const invalid = invalidResponse
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid()
  }
  const page = value as Record<string, unknown>
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.totalCount) || Number(page.totalCount) < 0
    || (page.nextCursor !== undefined && typeof page.nextCursor !== 'string')) {
    throw invalid()
  }
  const items = page.items.map((value): ProfileInterestPerson => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw invalid()
    }
    const person = value as Record<string, unknown>
    if (typeof person.profileRef !== 'string' || !person.profileRef.startsWith('p1.')
      || typeof person.nickname !== 'string' || !person.nickname.trim()
      || !['PLAYER', 'GUEST'].includes(String(person.userKind))
      || typeof person.interestedAt !== 'string' || !Number.isFinite(Date.parse(person.interestedAt))) {
      throw invalid()
    }
    return {
      ...parsePublicPersonDetails(person),
      profileRef: person.profileRef,
      nickname: person.nickname,
      avatarUrl: typeof person.avatarUrl === 'string' ? person.avatarUrl : undefined,
      headline: typeof person.headline === 'string' ? person.headline : undefined,
      userKind: person.userKind as 'PLAYER' | 'GUEST',
      interestedAt: person.interestedAt,
      ...(person.inviter === undefined ? {} : { inviter: parseProfileInterestInviter(person.inviter) }),
    }
  })
  return { items, totalCount: Number(page.totalCount), nextCursor: page.nextCursor as string | undefined }
}
