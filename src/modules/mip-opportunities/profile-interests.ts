import type { ProfileInterestPage, ProfileInterestPerson } from './types'
import { MipOpportunityError } from './error'

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
