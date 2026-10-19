import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { withinRenewalWindow } from '../src/packages/member/mip-growth/renewal-window'

describe('MIP growth player actions', () => {
  it('purchases and renews through the in-page confirm dialog', () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )
    const styles = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxss'),
      'utf8',
    )

    expect(script).toContain('mipCommerceModule.getMembershipBenefits()')
    expect(script).toContain('membership.membershipEndsAt')
    // MIW-83 D5：任务全量展示——游标聚合全部分页（页大小 20，防御上限 10 页）。
    expect(script).toContain('mipTasksModule.query.listTasks(cursor, TASK_PAGE_SIZE, force)')
    expect(script).toContain('const TASK_PAGE_LIMIT = 10')
    // MIW-65：会员方案页/订单确认页下线，开通与续费共用本页确认弹层后直接拉起支付。
    expect(script).toMatch(/openPurchaseDialog\(event[\s\S]{0,200}purchaseDialogVisible: true/)
    expect(script).toMatch(/confirmPurchase\(\)[\s\S]{0,900}performPurchase\(planId\)/)
    expect(script).toContain('mipCommerceModule.purchase({')
    expect(script).toContain('plansVerified')
    expect(script).not.toContain('requestPayment')
    expect(template).toContain('id="growth-purchase-dialog"')
    expect(template).toContain('id="growth-purchase-confirm"')
    expect(template).toContain('bind:tap="openPurchaseDialog"')
    expect(template).toContain('bind:tap="confirmPurchase"')
    expect(template).toContain('data-source="join"')
    expect(template).toContain('data-source="renew"')
    expect(template).toContain('《会员服务协议》')
    expect(template).toContain('立即续费')
    expect(template).toContain('立即加入')
    // MIW-83 D4：会员操作栏回归轻量「邀请入会」——原生转发按钮 + onShareAppMessage；
    // 完整邀请载体（海报/复制文案）仍不在本页。
    expect(template).toContain('邀请入会')
    expect(template).not.toContain('邀请加入')
    expect(template).toContain('openType="share"')
    expect(script).toMatch(/onShareAppMessage\(\)[\s\S]{0,200}MEMBERSHIP_INVITE_SHARE_TITLE/)
    // MIW-84：任务卡上后台配置的 SHARE 动作按钮（原生 button open-type=share，转发内容固定邀请语境）；
    // 会员「邀请入会」走 mip-pill-button 组件透传（openType），原生 open-type=share 全页仅任务卡一处。
    const shareButtons = template.match(/<button[^>]*open-type="share"[^>]*>/g) || []
    expect(shareButtons).toHaveLength(1)
    expect(shareButtons[0]).toContain('item.actionType === \'SHARE\'')
    expect(template).not.toContain('生成邀请海报')
    expect(template).not.toContain('复制邀请文案')
    expect(template).toContain('wx:if="{{membershipState === \'player\'}}"')
    expect(template).toContain('id="growth-invite-button"')
    // 续费窗口内才是双按钮组合：邀请入会（次）+ 立即续费（主）。
    expect(template).toContain('id="growth-renew-button"')
    expect(template).toContain('wx:if="{{renewWindowOpen}}"')
    expect(template).toContain('label="立即续费"')
    expect(template).toContain('{{membershipValidityText}}')
    expect(template).toContain('wx:for="{{tasks}}"')
    // 最新 J1-06 原型：可执行任务使用黄底胶囊，完成态与未开放态保持区分。
    // MIW-84：SHARE 按钮先渲染；AVAILABLE 胶囊仅在配置了 PAGE_JUMP 时出现（未配置=无动作，
    // 不能落入灰态 else 分支），非 AVAILABLE 状态保留灰态状态文案。
    expect(template).toContain('wx:elif="{{item.status === \'AVAILABLE\' && item.actionType === \'PAGE_JUMP\'}}"')
    expect(template).toContain('wx:elif="{{item.status !== \'AVAILABLE\'}}"')
    expect(template).toContain('growth-task-action border border-black bg-brand text-on-brand')
    const taskAction = styles.match(/\.growth-task-action\s*\{([^}]+)\}/)?.[1]
    expect(taskAction).toContain('height: 52rpx')
    expect(taskAction).toContain('font-size: 24rpx')
    expect(taskAction).toContain('border-radius: 9999rpx')
    expect(template).toContain('id="growth-member-actions"')
    expect(template).toContain('id="growth-join-actions"')
    expect(template).toContain('<mip-sticky-actions')
    expect(template).toContain('slot="actions"')
  })

  it('shows a read-only pending state while the first payment awaits the admin approval', () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )

    // MIW-27 第二轮：首笔付费等待管理后台审核。等级页如实展示审核中，
    // 不提供再次下单或邀请入口；会员结论仍由服务端投影决定。
    expect(script).toContain('membership.kind === \'PENDING\'')
    expect(script).toContain('membershipState: \'pending\'')
    expect(script).toContain('入会审核中，管理后台通过后生效')
    expect(script).toMatch(/membershipState: 'loading' as 'loading' \| 'player' \| 'guest' \| 'pending' \| 'error'/)
    expect(template).toContain('wx:elif="{{membershipState === \'pending\'}}"')
    expect(template).toContain('label="入会审核中" disabled')
    // 待审核态不出现任何下单入口。
    const pendingBlock = template.split('membershipState === \'pending\'')[1]?.split('</mip-sticky-actions>')[0] || ''
    expect(pendingBlock).not.toContain('openPurchaseDialog')
    expect(pendingBlock).not.toContain('openType="share"')
  })

  it('gates the renewal CTA to the final three months of the server-provided membership', () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )

    // figma 2165:17142：「立即续费」仅到期前 3 个月展示（到期时间为服务端会员事实）；
    // MIW-83 双按钮组合中同样以 renewWindowOpen 为闸。
    expect(script).toContain('import { withinRenewalWindow } from \'./renewal-window\'')
    expect(script).toContain('renewWindowOpen: withinRenewalWindow(membership.membershipEndsAt)')
    expect(script).toContain('\'有效期一年\'')
    expect(script).toMatch(/有效期至:\$\{formatDottedDate\(membership\.membershipEndsAt\)\}/)
    expect(template).toContain('wx:if="{{renewWindowOpen}}"')
    // 页面本体不写死金额（终审 C7：金额由服务端方案快照经确认弹层展示）。
    expect(template).not.toContain('6600')
    expect(template).not.toContain('¥')
  })

  it('clamps month-end overflow when computing the renewal window (5/31, 12/31, leap 2/29)', () => {
    const helper = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/renewal-window.ts'),
      'utf8',
    )

    // setMonth 直接减月会把 5/31 进位到 3/3；实现必须先退回 1 号再钳制到目标月最后一天。
    expect(helper).toContain('opensAt.setDate(1)')
    expect(helper).toMatch(/new Date\(opensAt\.getFullYear\(\), opensAt\.getMonth\(\) \+ 1, 0\)/)
    expect(helper).toContain('opensAt.setDate(Math.min(endDay, lastDayOfTargetMonth))')

    // 5/31 → 窗口 2/28 开（溢出实现会给 3/3）：3/1 已在窗口内。
    expect(withinRenewalWindow('2026-05-31', new Date(2026, 2, 1))).toBe(true)
    // 12/31 → 窗口 9/30 开（溢出实现会给 10/1）：10/1 已在窗口内。
    expect(withinRenewalWindow('2026-12-31', new Date(2026, 9, 1))).toBe(true)
    // 闰年 5/31 → 窗口 2/29 开（溢出实现会给 3/2）：3/1 已在窗口内。
    expect(withinRenewalWindow('2024-05-31', new Date(2024, 2, 1))).toBe(true)
    // 闰年 2/29 到期 → 窗口上年 11/29 开，12/1 已在窗口内。
    expect(withinRenewalWindow('2024-02-29', new Date(2023, 11, 1))).toBe(true)

    // 窗口开之前、到期之后仍然关闭；无效到期时间视为不在窗口。
    expect(withinRenewalWindow('2026-05-31', new Date(2026, 1, 27))).toBe(false)
    expect(withinRenewalWindow('2026-05-31', new Date(2026, 5, 2))).toBe(false)
    expect(withinRenewalWindow('not-a-date', new Date(2026, 5, 2))).toBe(false)
    // 窗口中段照常放行。
    expect(withinRenewalWindow('2026-08-31', new Date(2026, 6, 15))).toBe(true)
  })

  it('maps the frozen player-level visual hierarchy to server facts', () => {
    const pageConfig = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.json'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )

    expect(pageConfig).toContain('"navigationBarTitleText": "玩家会籍"')
    expect(pageConfig).toContain('"navigationBarBackgroundColor": "#FCDF03"')
    expect(pageConfig).toContain('"navigationBarTextStyle": "black"')
    expect(pageConfig).toContain('"backgroundColor": "#FCDF03"')
    expect(template).toContain('XP: {{snapshot.account.experienceBalance}}')
    expect(template).toContain('{{nextLevelThreshold}}')
    // MIW-83 GROWTH-02：权益计数跟随所选档位，黄色数字强调（figma 3984:8403 可享N项权益）。
    expect(template).toContain('可享<text id="growth-benefit-count"')
    expect(template).toContain('{{tierBenefitCount}}')
    expect(template).not.toContain('requestPayment')
  })

  it('keeps experience details above the character and opens its own page', () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )
    const styles = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxss'),
      'utf8',
    )

    // MIW-27：点击「经验值详情」跳转独立明细页（figma 1948:14177），不再原地展开滚动。
    expect(script).toContain('const EXPERIENCE_DETAILS_PAGE = \'/packages/member/mip-experience-details/index\'')
    expect(script).toMatch(/openExperienceDetails\(\)[\s\S]{0,120}url: EXPERIENCE_DETAILS_PAGE/)
    expect(script).not.toContain('experienceDetailsOpen')
    expect(script).not.toContain('pageScrollTo')
    expect(template).toContain('bind:tap="openExperienceDetails"')
    expect(template).not.toContain('growth-details-section')

    // 本轮按 mip-dev 原稿恢复右上角经验入口，避开等级和进度条，
    // 并较原右上角胶囊放大一档（24rpx 字号 + 8×20rpx 内边距）。
    const link = styles.match(/\.growth-experience-link\s*\{([^}]+)\}/)?.[1]
    expect(link).toContain('top: 12rpx')
    expect(link).toContain('padding: 8rpx 20rpx')
    expect(link).toContain('font-size: 24rpx')

    // 明细页已注册进分包路由（app.json 与 config/runtime-pages.json 契约一致）。
    const appJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'src/app.json'), 'utf8'),
    ) as { subPackages: Array<{ root: string, pages: string[] }> }
    const member = appJson.subPackages.find(pkg => pkg.root === 'packages/member')
    expect(member?.pages).toContain('mip-experience-details/index')
  })
})
