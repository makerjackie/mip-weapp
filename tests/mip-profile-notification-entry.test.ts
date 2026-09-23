import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('MIP profile notification entry', () => {
  it('syncs the inbox unread count from the messaging module', () => {
    const page = readSource('src/pages/profile/index.ts')

    expect(page).toContain(`import { mipMessagingModule } from '../../modules/mip-messaging/client'`)
    expect(page).toContain('notificationUnreadCount: 0')
    expect(page).toContain('this.loadNotificationUnread(snapshot, options)')
    expect(page).toContain('const cached = mipMessagingModule.peekUnreadCount()')
    expect(page).toContain('await mipMessagingModule.refreshUnreadCount({')
    expect(page).toContain('force: options.force')
    expect(page).toMatch(/if \(!snapshot\.authenticated\) \{[\s\S]*?notificationUnreadCount: 0/)
  })

  it('opens messages directly from profile with the unread count', () => {
    const page = readSource('src/pages/profile/index.ts')
    const template = readSource('src/pages/profile/index.wxml')
    expect(page).toContain('\'/packages/member/mip-notifications/index\'')
    expect(template).toContain('bind:tap="openNotifications"')
    expect(template).not.toContain('notificationUnreadCount > 99')
    expect(template).toContain('name="bell-notification" size="{{24}}"')
    expect(template).not.toContain('全部服务')
    expect(template).not.toContain('openServices')
  })

  it('retires tools and consolidates settings and support', () => {
    const app = readSource('src/app.json')
    for (const route of ['mip-services/index', 'mip-ai/index', 'mip-avatar/index', 'mip-opportunity-matching/index']) {
      expect(app).not.toContain(route)
    }
    const profile = readSource('src/pages/profile/index.wxml')
    for (const action of ['openGame', 'openHelp', 'openSettings']) {
      expect(profile).toContain(action)
    }
    expect(readSource('src/packages/member/privacy/index.wxml')).toContain('openNotificationSettings')
    expect(readSource('src/packages/member/mip-notifications/index.wxml')).not.toContain('requestWechatSubscription')
  })

  it('keeps every portfolio tab at the figma 80rpx band height (1770:38871)', () => {
    const styles = readSource('src/pages/profile/index.wxss')
    const tabRule = styles.match(/\.profile-tab\s*\{([\s\S]*?)\}/)?.[1]

    expect(tabRule).toBeDefined()
    expect(tabRule).toContain('min-height: 80rpx;')
  })
})
