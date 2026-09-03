import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/pages/profile/index.ts', import.meta.url), 'utf8')

function methodBody(name: string, nextMethod: string) {
  const start = source.indexOf(`  ${name}`)
  const end = source.indexOf(`\n  ${nextMethod}`, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('profile page readiness', () => {
  it('waits for every first-screen section before exposing the overall ready state', () => {
    const loadBody = methodBody('async loadProfileOnce', 'async loadInfluenceSummary')
    const allSettledStart = loadBody.indexOf('const sectionResults = await Promise.allSettled([')
    const allSettledEnd = loadBody.indexOf('])', allSettledStart)
    const sectionRequests = loadBody.slice(allSettledStart, allSettledEnd)

    expect(sectionRequests).toContain('this.loadBranch(snapshot, options)')
    expect(sectionRequests).toContain('this.loadIndustry(snapshot)')
    expect(sectionRequests).toContain('this.loadGrowth(snapshot, options)')
    expect(sectionRequests).toContain('this.loadBadges(snapshot)')
    expect(sectionRequests).toContain('this.loadCooperation()')
    expect(sectionRequests).toContain('this.loadCases()')
    expect(sectionRequests).toContain('this.loadOpportunities()')
    expect(sectionRequests).toContain('this.loadInfluenceSummary(snapshot)')
    expect(sectionRequests).toContain('this.loadNotificationUnread(snapshot, options)')
    expect(loadBody).toContain('state: \'ready\'')
    expect(loadBody).toContain('initialSectionsState: \'ready\'')
  })

  it('does not mark the page ready from the identity snapshot alone', () => {
    const identityBody = methodBody('applyIdentity', 'async loadBranch')
    expect(identityBody).toContain('identityState: \'ready\'')
    expect(identityBody).not.toContain('state: \'ready\'')
  })

  it('shares one in-flight load across repeated onShow and refresh calls', () => {
    const showBody = methodBody('onShow()', 'async loadProfile')
    const loadBody = methodBody('async loadProfile', 'async loadProfileOnce')
    expect(showBody).toContain('if (this.loadPromise)')
    expect(loadBody).toContain('if (this.loadPromise)')
    expect(loadBody).toContain('this.loadPromise = loadPromise')
    expect(loadBody).toContain('this.loadPromise = null')
  })

  it('keeps section failures visible without replacing successful section data', () => {
    expect(source).toContain('badgeState: \'error\'')
    expect(source).toContain('徽章数据暂时无法加载，请稍后重试。')
    expect(source).toContain('部分影响力数据暂时无法加载，请稍后重试。')
  })

  it('finishes the initial sections from a cached identity when the refresh fails', () => {
    const loadBody = methodBody('async loadProfileOnce', 'async loadInfluenceSummary')
    expect(loadBody).toContain('if (!cached)')
    expect(loadBody).toContain('snapshot = cached')
    expect(loadBody.indexOf('snapshot = cached')).toBeLessThan(loadBody.indexOf('const sectionResults = await Promise.allSettled(['))
    expect(loadBody).toContain('this.setData({ identityState: \'error\', message: \'资料更新失败，已保留上次结果。\' })')
  })

  it('reveals cached identity while the profile sections revalidate', () => {
    const loadBody = methodBody('async loadProfileOnce', 'async loadInfluenceSummary')
    expect(loadBody).toContain('this.setData({ state: \'ready\', initialSectionsState: \'loading\' })')
    expect(loadBody.indexOf('state: \'ready\', initialSectionsState: \'loading\'')).toBeLessThan(
      loadBody.indexOf('const sectionResults = await Promise.allSettled(['),
    )
  })

  it('throttles ordinary onShow refreshes but forces refresh after protected pages', () => {
    const showBody = methodBody('onShow()', 'async loadProfile')
    expect(source).toContain('PROFILE_REFRESH_INTERVAL_MS = 30_000')
    expect(showBody).toContain('lastSuccessfulRefreshAt')
    expect(showBody).toContain('refreshOnReturn')
    expect(showBody).toContain('loadProfile({ force: shouldForceRefresh })')
    const protectedBody = methodBody('async openProtected', 'openMembership')
    expect(protectedBody).toContain('this.refreshOnReturn = true')
  })

  it('shows immediate feedback and ignores repeated protected navigation taps', () => {
    expect(source).toContain('openingAction: \'\' as OpeningAction')
    expect(source).toContain('openingActionLock = false')
    expect(source).toContain('if (this.openingActionLock || this.data.openingAction)')
    expect(source).toContain('\'cooperation-list\'')
    expect(source).toContain('[\'AUTHENTICATED\', \'AGREEMENTS\']')
  })
})
