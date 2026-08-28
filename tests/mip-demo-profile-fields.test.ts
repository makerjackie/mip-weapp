import { describe, expect, it } from 'vitest'
import seed from '../database/mysql/mip/seed.demo.json'

const careerIdentityKeys = new Set([
  'BRAND_PRINCIPAL',
  'PROFESSIONAL_INVESTOR',
  'BIG_TECH_ELITE',
  'STUDENT',
  'PASSIONATE_FOUNDER',
  'FREE_EXPLORER',
  'COMPANY_OWNER',
  'SLASH_YOUTH',
])

describe('demo member profile fields', () => {
  it('keeps every showcase member ready for profile and card rendering', () => {
    expect(seed.users).toHaveLength(6)
    for (const user of seed.users) {
      expect(user.realName.trim()).not.toBe('')
      expect(['MALE', 'FEMALE', 'UNKNOWN']).toContain(user.gender)
      expect(careerIdentityKeys.has(user.careerIdentityKey)).toBe(true)
      expect(user.companies[0]?.name).toBeTruthy()
      expect(user.companies[0]?.role).toBeTruthy()
      expect(user.organizations[0]?.name).toBeTruthy()
      expect(user.organizations[0]?.role).toBeTruthy()
    }
  })
})
