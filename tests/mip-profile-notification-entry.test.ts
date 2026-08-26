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

  it('exposes the existing protected inbox route with a visible unread state', () => {
    const page = readSource('src/pages/profile/index.ts')
    const template = readSource('src/pages/profile/index.wxml')

    expect(page).toContain(`openNotifications() { void this.openProtected('/packages/member/mip-notifications/index', 'INTERACT') }`)
    expect(template).toContain('bind:tap="openNotifications"')
    expect(template).toContain('aria-role="button"')
    expect(template).toContain('站内消息')
    expect(template).toContain('{{notificationUnreadCount}} 条未读')
    expect(template).toContain('暂无未读消息')
    expect(template).toContain(`{{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}}`)
  })

  it('keeps every portfolio tab touch target at least 88rpx high', () => {
    const styles = readSource('src/pages/profile/index.wxss')
    const tabRule = styles.match(/\.profile-tab\s*\{([\s\S]*?)\}/)?.[1]

    expect(tabRule).toBeDefined()
    expect(tabRule).toContain('min-height: 88rpx;')
  })
})
