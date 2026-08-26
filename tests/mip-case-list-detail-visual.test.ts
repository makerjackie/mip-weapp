import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP super case list and detail visuals', () => {
  it('uses a compact timeline for real case summaries and keeps every list state visible', () => {
    const page = source('src/packages/member/mip-cases/list/index.ts')
    const template = source('src/packages/member/mip-cases/list/index.wxml')

    expect(page).toContain('formatPublishedMonth')
    expect(page).toMatch(/state: reset \? 'error' : 'ready'/)
    expect(template).toContain('aria-role="tablist"')
    expect(template).toContain('item.publishedText || item.statusText')
    expect(template).toContain('left-[-76rpx]')
    expect(template).toMatch(/state === 'loading'/)
    expect(template).toMatch(/state === 'error'/)
    expect(template).toContain('!items.length')
    expect(template).toContain('正在加载更多案例')
    expect(template).not.toContain('展示已发布的项目经历和结果。')
  })

  it('matches the Figma cover-to-facts hierarchy and protects fixed actions with the safe area', () => {
    const page = source('src/packages/member/mip-cases/detail/index.ts')
    const template = source('src/packages/member/mip-cases/detail/index.wxml')
    const config = JSON.parse(source('src/packages/member/mip-cases/detail/index.json'))

    expect(page).toContain('periodText')
    expect(page).toContain('classificationText')
    expect(template).toContain('h-[300rpx]')
    expect(template).toContain('展开讲讲')
    expect(template).toContain('item.caption')
    expect(template).toContain('wx:if="{{item.status === \'PUBLISHED\'}}" open-type="share"')
    expect(template).toContain('bottom-[calc(env(safe-area-inset-bottom)+16rpx)]')
    expect(template).toContain('min-h-[112rpx]')
    expect(template).toContain('下架案例')
    expect(template).toContain('删除案例')
    expect(template).toMatch(/state === 'ready' && !item/)
    expect(config.navigationBarTitleText).toBe('超级案例')
  })
})
