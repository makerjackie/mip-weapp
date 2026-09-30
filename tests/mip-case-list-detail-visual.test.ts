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

    expect(page).toContain('startedOnText')
    expect(page).toContain('projects: item.projects.map')
    expect(template).toContain('wx:for="{{item.projects}}"')
    expect(template).toContain('item.projects.length > 1')
    expect(template).toContain('项目名称')
    expect(template).toContain('一句话描述案例')
    expect(template).toContain('开始时间')
    expect(template).toContain('担任职责')
    expect(template).toContain('主营城市')
    expect(template).toContain('主营地区')
    expect(template).toContain('项目类型')
    expect(template).toContain('h-[300rpx]')
    expect(template).toContain('展开讲讲')
    expect(template).toContain('item.caption')
    expect(template).toContain('label="分享" withIcon openType="share"')
    expect(template).toContain('<mip-sticky-actions')
    expect(template).toContain('slot="actions"')
    expect(template).toContain('min-h-[112rpx]')
    expect(template).toContain('下架案例')
    expect(template).toContain('删除案例')
    expect(template).toMatch(/state === 'ready' && !item/)
    expect(config.navigationBarTitleText).toBe('超级案例')
  })
})
