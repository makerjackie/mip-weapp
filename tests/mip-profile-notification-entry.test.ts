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

  it('moves the inbox into all services while keeping the profile unread badge', () => {
    const page = readSource('src/pages/profile/index.ts')
    const template = readSource('src/pages/profile/index.wxml')
    const servicesPage = readSource('src/packages/member/mip-services/index.ts')
    const servicesTemplate = readSource('src/packages/member/mip-services/index.wxml')

    expect(page).toContain(`openServices() { caseNavigateTo({ url: '/packages/member/mip-services/index' }) }`)
    expect(template).toContain('bind:tap="openServices"')
    expect(template).toContain('aria-role="button"')
    expect(template).toContain('全部服务')
    expect(template).toContain(`{{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}}`)
    expect(template).not.toContain('更多服务')
    expect(servicesPage).toContain(`openNotifications() { void this.openProtected('/packages/member/mip-notifications/index', 'INTERACT') }`)
    expect(servicesTemplate).toContain('bind:tap="openNotifications"')
    expect(servicesTemplate).toContain('站内消息')
    expect(servicesTemplate).toContain('{{notificationUnreadCount}} 条未读')
    expect(servicesTemplate).toContain('暂无未读')
    expect(servicesTemplate).toContain(`{{notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}}`)
  })

  it('groups every former profile service on the secondary page', () => {
    const page = readSource('src/packages/member/mip-services/index.ts')
    const template = readSource('src/packages/member/mip-services/index.wxml')
    const config = JSON.parse(readSource('src/packages/member/mip-services/index.json'))

    expect(config.navigationBarTitleText).toBe('全部服务')
    for (const group of ['互动', '工具', '账号与支持']) {
      expect(template).toContain(`>${group}</view>`)
    }
    for (const handler of [
      'openGame',
      'openHeartHistory',
      'openNotifications',
      'openDigitalAvatar',
      'openAiDrafts',
      'openMatching',
      'openBranches',
      'openOpportunitySettings',
      'openBenefits',
      'openHelp',
      'openAbout',
    ]) {
      expect(template).toContain(`bind:tap="${handler}"`)
    }
    for (const route of [
      '/packages/member/mip-game/index',
      '/packages/member/mip-hearts/index',
      '/packages/member/mip-notifications/index',
      '/packages/member/mip-avatar/index',
      '/packages/member/mip-ai/index',
      '/packages/member/mip-opportunity-matching/index',
      '/packages/member/mip-branches/index',
      '/packages/member/mip-opportunity-settings/index',
      '/packages/member/benefits/index',
      '/packages/member/help/index',
      '/packages/member/about/index',
    ]) {
      expect(page).toContain(route)
    }
    expect(template).toContain('<app-page-exit label="返回我的"')
  })

  it('keeps every portfolio tab touch target at least 88rpx high', () => {
    const styles = readSource('src/pages/profile/index.wxss')
    const tabRule = styles.match(/\.profile-tab\s*\{([\s\S]*?)\}/)?.[1]

    expect(tabRule).toBeDefined()
    expect(tabRule).toContain('min-height: 88rpx;')
  })
})
