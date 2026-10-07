import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('runtime page resilience', () => {
  it('exposes the active opportunity tab through the aggregate runtime state', () => {
    // 2026-10-07：独立「我的机会」页删除后，机会 Tab 的聚合态统一在机会页
    // 单一 state 字段上流转（loading → ready/error），三个 Tab 共用。
    const page = read('src/pages/opportunities/index.ts')

    expect(page).toContain('state: \'loading\' as \'loading\' | \'ready\' | \'error\'')
    expect(page).toContain('this.setData({ state: \'loading\', nextCursor: \'\', message: \'\' })')
    expect(page.match(/state: 'ready',/g)?.length).toBe(3)
    expect(page).toContain('state: \'error\',')
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
