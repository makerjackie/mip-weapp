import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertNoSensitivePageData,
  evaluateRouteState,
} from '../scripts/verify-runtime.mjs'
import {
  clearPrivatePhones,
  maskedPhone,
  privatePhone,
  replacePrivatePhones,
} from '../src/packages/admin/shared/private-phone'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/runtime-pages.json'))

describe('runtime page privacy and normal unavailable states', () => {
  it('keeps authorized roster phones usable without exposing originals in page data', () => {
    const owner = {}
    replacePrivatePhones(owner, [{ id: 'registration-1', phoneNumber: '+86 188-1925-3403' }])

    expect(maskedPhone('18819253403')).toBe('188 **** 3403')
    expect(privatePhone(owner, 'registration-1')).toBe('18819253403')
    expect(() => assertNoSensitivePageData({
      items: [{ id: 'registration-1', phoneNumberMasked: '188 **** 3403' }],
    }, 'packages/admin/event-registrations/index', contract.sensitivePatterns)).not.toThrow()
    expect(() => assertNoSensitivePageData({
      canViewSensitiveRoster: true,
      items: [{ id: 'registration-1', phoneNumber: '18819253403' }],
    }, 'packages/admin/event-registrations/index', contract.sensitivePatterns)).toThrow('page data contains sensitive values')

    clearPrivatePhones(owner)
    expect(privatePhone(owner, 'registration-1')).toBe('')
  })

  it('does not bind roster or support phone originals into page data', () => {
    const registrationPage = read('src/packages/admin/event-registrations/index.ts')
    const participantPage = read('src/packages/admin/event-participants/index.ts')
    const registrationView = read('src/packages/admin/event-registrations/index.wxml')
    const eventDetail = read('src/packages/member/mip-events/detail/index.ts')
    const eventData = eventDetail.slice(eventDetail.indexOf('data: {'), eventDetail.indexOf('requestSeq:'))

    expect(registrationPage).toContain('Omit<AdminRosterItem, \'phoneNumber\'>')
    expect(participantPage).toContain('Omit<AdminRosterAllItem, \'phoneNumber\'>')
    expect(registrationView).toContain('phoneNumberMasked')
    expect(registrationView).not.toMatch(/\{\{item\.phoneNumber[\s|}]/)
    expect(eventData).not.toContain('supportPhone')
    expect(eventDetail).toMatch(/callSupport\(\)[\s\S]*const supportPhone = mipOperationsConfig\.supportPhone/)
  })

  it('accepts direct access recovery and optional avatar availability as settled states', () => {
    const access = contract.routes.find((route: { path: string }) => route.path === 'packages/member/mip-access/index')
    const avatar = contract.routes.find((route: { path: string }) => route.path === 'packages/member/mip-avatar/index')

    expect(evaluateRouteState(access, { state: 'empty' })).toMatchObject({ status: 'passed', state: 'empty' })
    expect(evaluateRouteState(avatar, { state: 'unconfigured' })).toMatchObject({ status: 'passed', state: 'unconfigured' })
    expect(avatar.pendingStates).toBeUndefined()
    expect(read('src/packages/member/mip-access/index.wxml')).toContain('state === \'empty\'')
  })

  it('scrolls the profile portfolio controls into the evidence viewport before each interaction', () => {
    const journey = contract.interactionJourneys.find((item: { id: string }) => item.id === 'profile-content-tabs')

    expect(journey.scrollTop).toBeGreaterThan(0)
    expect(read('scripts/verify-runtime.mjs')).toContain('miniProgram.pageScrollTo(journey.scrollTop)')
  })
})
