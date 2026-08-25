import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildEventPhonePreview,
  formatEventPreviewAccess,
  formatEventPreviewLocation,
  formatEventPreviewTime,
} from '../src/components/event-phone-preview/model'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP event phone preview projection', () => {
  it('formats local date controls without requiring a saved event', () => {
    expect(formatEventPreviewTime('2030-05-18', '09:30', '2030-05-18', '12:00'))
      .toBe('2030年5月18日 周六 09:30–12:00')
    expect(formatEventPreviewTime('2030-05-18', '09:30', '2030-05-19', '12:00'))
      .toBe('2030年5月18日 周六 09:30 至 2030年5月19日 周日 12:00')
    expect(formatEventPreviewTime('', '', '', '')).toBe('活动时间待定')
  })

  it('projects only current draft location and access facts', () => {
    expect(formatEventPreviewLocation({
      eventMode: 'OFFLINE',
      venueName: 'MIP 空间',
      address: '深圳市南山区示例路 1 号',
    })).toBe('MIP 空间 · 深圳市南山区示例路 1 号')
    expect(formatEventPreviewLocation({ eventMode: 'ONLINE' })).toBe('线上活动')
    expect(formatEventPreviewLocation({ eventMode: 'HYBRID', cityName: '深圳' })).toBe('深圳 · 线上同步')
    expect(formatEventPreviewAccess({ accessType: 'FREE' })).toBe('免费报名')
    expect(formatEventPreviewAccess({ accessType: 'MEMBER_INCLUDED' })).toBe('玩家权益包含')
    expect(formatEventPreviewAccess({ accessType: 'PAID', priceYuan: '99.90' })).toBe('¥99.90 报名')
    expect(formatEventPreviewAccess({ accessType: 'PAID', priceYuan: '' })).toBe('付费报名')
  })

  it('rebuilds from changed unsaved draft, cover, controls, and branch display name', () => {
    const draft = {
      scopeType: 'BRANCH',
      title: '第一次填写',
      summary: '活动摘要',
      description: '活动介绍',
      notices: '请准时到场',
      eventMode: 'OFFLINE',
      accessType: 'FREE',
      venueName: '旧场地',
      contentMedia: [{ imageUrl: 'https://example.test/a.jpg', caption: '介绍图片' }],
    }
    const first = buildEventPhonePreview({
      draft,
      coverUrl: 'https://example.test/old.jpg',
      branchName: '深圳分会',
      startsDate: '2030-05-18',
      startsTime: '09:30',
      endsDate: '2030-05-18',
      endsTime: '12:00',
    })
    const second = buildEventPhonePreview({
      draft: { ...draft, title: '修改后的标题', venueName: '新场地' },
      coverUrl: 'https://example.test/new.jpg',
      branchName: '广州分会',
      startsDate: '2030-06-01',
      startsTime: '14:00',
      endsDate: '2030-06-01',
      endsTime: '16:00',
    })

    expect(first).toMatchObject({
      title: '第一次填写',
      coverUrl: 'https://example.test/old.jpg',
      scopeLabel: '深圳分会',
      locationText: '旧场地',
    })
    expect(second).toMatchObject({
      title: '修改后的标题',
      coverUrl: 'https://example.test/new.jpg',
      scopeLabel: '广州分会',
      locationText: '新场地',
      timeText: '2030年6月1日 周六 14:00–16:00',
    })
    expect(second.contentMedia).toEqual([{ imageUrl: 'https://example.test/a.jpg', caption: '介绍图片' }])
  })

  it('uses an accessible scrollable 375px device without backend calls', () => {
    const component = read('src/components/event-phone-preview/index.wxml')
    const componentConfig = JSON.parse(read('src/components/event-phone-preview/index.json'))
    const styles = read('src/components/event-phone-preview/index.wxss')
    const controller = read('src/components/event-phone-preview/index.ts')
    const model = read('src/components/event-phone-preview/model.ts')
    const page = read('src/packages/admin/events/index.wxml')
    const pageController = read('src/packages/admin/events/index.ts')
    const pageConfig = JSON.parse(read('src/packages/admin/events/index.json'))

    expect(pageConfig.usingComponents['event-phone-preview']).toBe('/components/event-phone-preview/index')
    expect(componentConfig.styleIsolation).toBe('apply-shared')
    expect(page).toContain('bind:tap="openPhonePreview"')
    expect(page).toContain('bind:close="closePhonePreview"')
    expect(pageController).toContain('buildEventPhonePreview({')
    expect(pageController).toContain('draft: this.data.draft')
    const closeMethod = pageController.match(/closePhonePreview\(\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(closeMethod).toContain('phonePreviewVisible: false')
    expect(closeMethod).not.toContain('draft')
    expect(component).toContain('scroll-y')
    expect(component).toContain('disabled aria-label="预览中不可报名"')
    expect(component).not.toMatch(/参与人数|主办方/)
    expect(styles).toContain('width: calc(100vw - 24px)')
    expect(styles).toContain('max-width: 375px')
    expect(styles).toContain('@media (min-width: 600px)')
    expect(styles).toContain('width: 375px')
    expect(styles).toContain('env(safe-area-inset-bottom)')
    expect(styles).toContain('min-width: 44px')
    expect(`${component}\n${controller}\n${model}`).not.toMatch(/wx\.cloud|callFunction|mipAdminModule/)
  })
})
