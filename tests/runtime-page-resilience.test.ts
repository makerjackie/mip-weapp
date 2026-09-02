import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('runtime page resilience', () => {
  it('exposes the active opportunity tab through the aggregate runtime state', () => {
    const page = read('src/packages/member/mip-opportunities/mine/index.ts')

    expect(page).toContain('state: \'loading\' as SectionState')
    expect(page).toContain('state: tab === \'PUBLISHED\' ? this.data.publishedState : this.data.referredState')
    expect(page).toContain('this.data.tab === \'PUBLISHED\' ? { state: \'ready\' as SectionState } : {}')
    expect(page).toContain('this.data.tab === \'REFERRED\' ? { state: \'ready\' as SectionState } : {}')
  })

  it('re-resolves the original scene when event detail loading is retried', () => {
    const page = read('src/packages/member/mip-events/detail/index.ts')
    const view = read('src/packages/member/mip-events/detail/index.wxml')

    expect(page).toContain('entryScene: \'\'')
    expect(page).toContain('this.entryScene = scene')
    expect(page).toContain('void this.loadInvitationScene(this.entryScene)')
    expect(page).toContain('void this.loadCheckInScene(this.entryScene)')
    expect(view).toContain('bind:action="retryLoad"')
  })

  it('keeps payment polling isolated to one Page instance', () => {
    const page = read('src/packages/member/payment-result/index.ts')

    expect(page).toContain('pollTimer: undefined as ReturnType<typeof setTimeout> | undefined')
    expect(page).toContain('this.pollTimer = setTimeout')
    expect(page).toContain('clearTimeout(this.pollTimer)')
    expect(page).not.toMatch(/^let pollTimer:/m)
  })

  it('shows feedback when help-page native capabilities fail', () => {
    const page = read('src/packages/member/help/index.ts')

    expect(page).toContain('fail: () => wx.showToast({ title: \'暂时无法拨打电话\', icon: \'none\' })')
    expect(page).toContain('fail: () => wx.showToast({ title: \'暂时无法打开视频号\', icon: \'none\' })')
  })
})
