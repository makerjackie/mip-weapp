import type { ProfileInterestPage, ProfileInterestPerson, PublicPersonDetails } from './types'
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

/** Validate the non-empty roster contract and never forward private server fields. */
export function parseProfileInterests(value: unknown): ProfileInterestPage {
  const invalid = () => new MipOpportunityError('INVALID_RESPONSE', '感兴趣名单返回的数据格式不正确，请稍后重试。', true)
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
    }
  })
  return { items, totalCount: Number(page.totalCount), nextCursor: page.nextCursor as string | undefined }
}
