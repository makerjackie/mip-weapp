import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

/** journey-review WS-MEMBERSHIP：我的页游客最小帧（J1-08）与登录态四卡/站内信（J3-04）。 */
describe('MIP profile membership journey frames', () => {
  it('keeps the guest frame to login hero, locked banner and the four entries (1862:18360)', () => {
    const template = readSource('src/pages/profile/index.wxml')
    const guestStart = template.indexOf('wx:if="{{!authenticated}}"')
    const memberStart = template.indexOf('wx:else class="profile-hero"')
    const statsStart = template.indexOf('<mip-stat-header')

    expect(guestStart).toBeGreaterThan(-1)
    expect(memberStart).toBeGreaterThan(guestStart)
    expect(statsStart).toBeGreaterThan(memberStart)

    const guestBlock = template.slice(guestStart, memberStart)
    expect(guestBlock).toContain('登录注册')
    expect(guestBlock).toContain('请登录后查看')
    // 游客分支内不出现数据统计 / NPC任务 / MIP勋章 / 合作卡 / 站内信。
    expect(guestBlock).not.toContain('嘉宾')
    expect(guestBlock).not.toContain('NPC任务')
    expect(guestBlock).not.toContain('MIP勋章')
    expect(guestBlock).not.toContain('合作卡')
    expect(guestBlock).not.toContain('站内信')

    // 四入口网格：活动 / 名片 / 订单 / 设置（站内信不在其中，迁至右上角）。
    const actionsStart = template.indexOf('id="profile-service-actions"')
    const actionsEnd = template.indexOf('</view>', template.indexOf('设置</text>'))
    const actionsBlock = template.slice(actionsStart, actionsEnd)
    for (const label of ['活动', '名片', '订单', '设置']) {
      expect(actionsBlock).toContain(`<text>${label}</text>`)
    }
    expect(actionsBlock).not.toContain('<text>消息</text>')

    // 数据统计、NPC任务/MIP勋章、合作卡 tabs、服务组、站内信只进登录态分支。
    expect(template).toMatch(/<mip-stat-header\s+wx:if="\{\{authenticated\}\}"[\s\S]*?class="profile-stats"/)
    expect(template).toContain('wx:if="{{authenticated}}" class="profile-feature-grid"')
    expect(template).toContain('wx:if="{{authenticated}}" class="profile-tabs"')
    expect(template).toContain('wx:if="{{authenticated}}" class="mt-6 overflow-hidden rounded-[24rpx] bg-panel"')
  })

  it('gates every guest entry behind the login flow, including settings', () => {
    const script = readSource('src/pages/profile/index.ts')

    for (const handler of ['openLogin', 'openProfileEdit', 'openMemberCard', 'openRegistrations', 'openOrders', 'openSettings']) {
      expect(script).toContain(`${handler}()`)
    }
    // J1-08：设置入口也走 openProtected（六入口口径），目标为账号设置页（WS-SETTINGS 路由）。
    expect(script).toContain('openSettings() { void this.openProtected(\'/packages/member/privacy/index\', \'EDIT_PROFILE\') }')
    expect(script).not.toContain('caseNavigateTo({ url: \'/packages/member/privacy/index\' })')
  })

  it('moves the inbox entry to the top-right of the mine header with an unread badge', () => {
    const template = readSource('src/pages/profile/index.wxml')
    const styles = readSource('src/pages/profile/index.wxss')

    expect(template).toContain('class="profile-inbox-entry"')
    expect(template).toContain('bind:tap="openNotifications"')
    expect(template).toContain('profile-inbox-unread')
    expect(template).toContain('notificationUnreadCount > 99')
    expect(styles).toMatch(/\.profile-inbox-entry\s*\{[\s\S]*?position: absolute;/)
    expect(styles).toMatch(/\.profile-inbox-entry\s*\{[\s\S]*?right: 24rpx;/)
    // 站内信 72rpx 命中区叠在 summary 右端之上：档案编辑区留出右侧 padding，命中不被截走。
    expect(styles).toMatch(/\.profile-summary\s*\{[\s\S]*?padding-right: 88rpx;/)
    // 红点中心对齐图标右上角（图标 40rpx 居中于 72rpx 命中区），修正原 16rpx 错位。
    expect(styles).toMatch(/\.profile-inbox-unread\s*\{[\s\S]*?top: -2rpx;/)
    expect(styles).toMatch(/\.profile-inbox-unread\s*\{[\s\S]*?right: -2rpx;/)
  })

  it('badges both hearts and visitors from their received-list unread counts', () => {
    const script = readSource('src/pages/profile/index.ts')
    const template = readSource('src/pages/profile/index.wxml')
    const statHeader = readSource('src/components/mip-stat-header/index.wxml')

    // M1 00:35:58：心动值 / 访客有红点，嘉宾 / 互动过无。
    expect(script).toContain('opportunityModule.listReceived(\'ACTIVE_INTEREST\')')
    expect(script).toContain('updates.interestUnreadCount = interestResult.value.unreadCount')
    expect(script).toContain('interestUnreadCount: 0')
    expect(template).toContain('label: \'心动值\', category: \'ACTIVE_INTEREST\', target: \'influence\', badge: interestUnreadCount > 0, badgeLabel: \'有新的心动\'')
    expect(template).toContain('label: \'访客\', target: \'visitor\', badge: visitorUnreadCount > 0')
    expect(template).not.toContain('label: \'嘉宾\', category: \'GUEST\', target: \'influence\', badge')
    expect(template).not.toContain('label: \'互动过\', category: \'INTERACTION\', target: \'influence\', badge')
    // badge aria-label 由 item 传入；未传时保持「有新访客」默认（共享组件向后兼容）。
    expect(statHeader).toContain('aria-label="{{item.badgeLabel || \'有新访客\'}}"')
  })

  it('keeps the four stat cards on the agreed WS-PEOPLE routes', () => {
    const script = readSource('src/pages/profile/index.ts')

    // 嘉宾/互动过/访客走 influence scope 模板；心动值走 hearts scope（与 WS-PEOPLE 约定一致）。
    expect(script).toMatch(/scope=influence&category=\$\{category\}/)
    expect(script).toContain('[\'GUEST\', \'INTERACTION\', \'ACTIVE_INTEREST\'].includes(category)')
    expect(script).toContain('({ 嘉宾: \'GUEST\', 互动过: \'INTERACTION\', 心动值: \'ACTIVE_INTEREST\' }')
    expect(script).toContain('\'/packages/member/mip-received/index?scope=hearts&category=ACTIVE_INTEREST\'')
    expect(script).toContain('\'/packages/member/mip-received/index?scope=influence&category=VISITOR\'')
    expect(script).toContain('\'/packages/member/mip-notifications/index\'')
  })
})
