import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertNoSensitivePageData,
  evaluateRouteState,
  interactionTargetViewportEvidence,
  queryFreshRenderedActionElement,
} from '../scripts/verify-runtime.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/runtime-pages.json'))

describe('runtime page privacy and normal unavailable states', () => {
  it('keeps phone originals out of onsite roster page data', () => {
    expect(() => assertNoSensitivePageData({
      items: [{ id: 'registration-1', phoneNumberMasked: '+86 188****3403' }],
    }, 'packages/admin/event-registrations/index', contract.sensitivePatterns)).not.toThrow()
    expect(() => assertNoSensitivePageData({
      canViewSensitiveRoster: true,
      items: [{ id: 'registration-1', phoneNumber: '18819253403' }],
    }, 'packages/admin/event-registrations/index', contract.sensitivePatterns)).toThrow('page data contains sensitive values')
  })

  it('does not bind roster or support phone originals into page data', () => {
    const registrationPage = read('src/packages/admin/event-registrations/index.ts')
    const registrationView = read('src/packages/admin/event-registrations/index.wxml')
    const eventDetail = read('src/packages/member/mip-events/detail/index.ts')
    const eventData = eventDetail.slice(eventDetail.indexOf('data: {'), eventDetail.indexOf('requestSeq:'))

    expect(registrationPage).toContain('Omit<AdminRosterItem, \'phoneNumber\'>')
    expect(registrationView).not.toContain('phoneNumber')
    expect(registrationView).not.toMatch(/\{\{item\.phoneNumber[\s|}]/)
    expect(eventData).not.toContain('supportPhone')
    expect(eventDetail).toMatch(/callSupport\(\)[\s\S]*const supportPhone = mipOperationsConfig\.supportPhone/)
  })

  it('allows only the explicitly reviewed self-card phone field', () => {
    const card = contract.routes.find((route: { path: string }) => route.path === 'packages/member/mip-card/index')
    expect(card.allowedSensitivePaths).toEqual(['phone'])
    expect(() => assertNoSensitivePageData({
      phone: '18819253403',
      nested: { phone: '18819253403' },
    }, card.path, contract.sensitivePatterns, card.allowedSensitivePaths)).toThrow('page data contains sensitive values')
    expect(() => assertNoSensitivePageData({
      phone: '18819253403',
      phoneMasked: '188****3403',
    }, card.path, contract.sensitivePatterns, card.allowedSensitivePaths)).not.toThrow()
  })

  it('classifies direct access recovery as external wait and optional avatar availability as settled', () => {
    const access = contract.routes.find((route: { path: string }) => route.path === 'packages/member/mip-access/index')
    const avatar = contract.routes.find((route: { path: string }) => route.path === 'packages/member/mip-avatar/index')

    expect(evaluateRouteState(access, { state: 'expired' })).toMatchObject({ status: 'external-wait', state: 'expired' })
    expect(evaluateRouteState(access, { state: 'ready' })).toMatchObject({ status: 'passed', state: 'ready' })
    expect(evaluateRouteState(avatar, { state: 'unconfigured' })).toMatchObject({ status: 'passed', state: 'unconfigured' })
    expect(avatar.pendingStates).toBeUndefined()
    expect(read('src/packages/member/mip-access/index.wxml')).toContain('state === \'expired\'')
  })

  it('requires measured target visibility, rendered actions, and screenshot changes for profile tabs', () => {
    const journey = contract.interactionJourneys.find((item: { id: string }) => item.id === 'profile-content-tabs')
    const verifier = read('scripts/verify-runtime.mjs')

    expect(journey.scrollTop).toBeUndefined()
    expect(journey).toMatchObject({
      requireVisibleTarget: true,
      requireRenderedAction: true,
      requireScreenshotDiff: true,
    })
    expect(journey.steps).toHaveLength(2)
    for (const step of journey.steps) {
      expect(step).toMatchObject({
        scrollIntoView: true,
      })
      expect(step.scrollTop).toBeUndefined()
    }
    for (const viewport of [
      { windowHeight: 724, windowWidth: 375 },
      { windowHeight: 768, windowWidth: 1024 },
    ]) {
      expect(interactionTargetViewportEvidence([
        { top: 100, bottom: 180, left: 20, right: 140, width: 120, height: 80 },
      ], viewport)).toMatchObject({
        top: 100,
        bottom: 180,
        left: 20,
        right: 140,
        ...viewport,
      })
      expect(interactionTargetViewportEvidence([
        { top: 100, bottom: 180, left: viewport.windowWidth - 119, right: viewport.windowWidth + 1, width: 120, height: 80 },
      ], viewport)).toBeNull()
    }
    expect(interactionTargetViewportEvidence([
      { top: 800, bottom: 880, left: 20, right: 140, width: 120, height: 80 },
    ], { windowHeight: 720, windowWidth: 390 })).toBeNull()
    expect(interactionTargetViewportEvidence([
      { top: 100, bottom: 180, left: 410, right: 530, width: 120, height: 80 },
    ], { windowHeight: 720, windowWidth: 390 })).toBeNull()
    expect(interactionTargetViewportEvidence([
      { top: 100, bottom: 180, left: -140, right: -20, width: 120, height: 80 },
    ], { windowHeight: 720, windowWidth: 390 })).toBeNull()
    expect(interactionTargetViewportEvidence([
      { top: -20, bottom: 60, left: 20, right: 140, width: 120, height: 80 },
    ], { windowHeight: 720, windowWidth: 390 })).toBeNull()
    expect(interactionTargetViewportEvidence([
      { top: 680, bottom: 760, left: 20, right: 140, width: 120, height: 80 },
    ], { windowHeight: 720, windowWidth: 390 })).toBeNull()
    expect(interactionTargetViewportEvidence([
      { top: 100, bottom: 180, left: -20, right: 100, width: 120, height: 80 },
    ], { windowHeight: 720, windowWidth: 390 })).toBeNull()
    expect(interactionTargetViewportEvidence([
      { top: 100, bottom: 180, left: 310, right: 430, width: 120, height: 80 },
    ], { windowHeight: 720, windowWidth: 390 })).toBeNull()
    expect(verifier).toContain('miniProgram.callWxMethod(\'pageScrollTo\', { selector: step.selector, duration: 0 })')
    expect(verifier).toContain('assertInteractionTargetInViewport')
    expect(verifier).toContain('queryFreshRenderedActionElement(page, step.selector)')
    expect(verifier).toContain('was already satisfied before the rendered tap')
    expect(verifier).toContain('const requireRenderedAction = (step.requireRenderedAction ?? journey.requireRenderedAction) === true')
    expect(verifier).toContain('const requireScreenshotDiff = (step.requireScreenshotDiff ?? journey.requireScreenshotDiff) === true')
  })

  it('drops cached automator handles before every strict rendered action query', async () => {
    const stale = { id: 'stale' }
    const fresh = [{ id: 'fresh-1' }, { id: 'fresh-2' }] as const
    const elementMap = new Map([['profile-tab-cases', stale]])
    let queryCount = 0
    const page = {
      elementMap,
      $: async (selector: string, options: { fallback: boolean }) => {
        expect(selector).toBe('#profile-tab-cases')
        expect(options).toEqual({ fallback: false })
        expect(elementMap.size).toBe(0)
        const element = queryCount === 0 ? fresh[0] : fresh[1]
        queryCount += 1
        elementMap.set('profile-tab-cases', element)
        return element
      },
    }

    await expect(queryFreshRenderedActionElement(page, '#profile-tab-cases')).resolves.toBe(fresh[0])
    await expect(queryFreshRenderedActionElement(page, '#profile-tab-cases')).resolves.toBe(fresh[1])
    expect(elementMap.get('profile-tab-cases')).toBe(fresh[1])
    expect(queryCount).toBe(2)
  })

  it('guards sensitive roster pagination against stale page requests', () => {
    const page = read('src/packages/admin/event-registrations/index.ts')
    const pagination = page.slice(page.indexOf('async loadMoreRoster()'), page.indexOf('onReachBottom()'))

    expect(pagination).toContain('const seq = this.requestSeq')
    expect(pagination).toContain('if (seq !== this.requestSeq)')
    expect(pagination.indexOf('if (seq !== this.requestSeq)')).toBeLessThan(
      pagination.indexOf('items: this.data.items.concat(page.items.map(rosterView))'),
    )
  })
})
