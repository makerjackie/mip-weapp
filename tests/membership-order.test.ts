import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('MIP membership order confirmation page (journey-review J1-07 join-order)', () => {
  it('registers the route in app.json and the runtime inventory', () => {
    const app = readSource('src/app.json')
    expect(app).toContain('"membership-order/index"')

    const runtimePages = JSON.parse(readSource('config/runtime-pages.json'))
    const route = runtimePages.routes.find(
      (item: { path: string }) => item.path === 'packages/member/membership-order/index',
    )
    expect(route).toMatchObject({
      selector: '#mip-membership-order-page',
      kind: 'data',
      states: ['loading', 'ready', 'error'],
    })
    expect(runtimePages.routeCount).toBe(runtimePages.routes.length)

    const project = JSON.parse(readSource('config/project.json'))
    expect(project.routes.some(
      (item: { pathName: string }) => item.pathName === 'packages/member/membership-order/index',
    )).toBe(true)
  })

  it('renders the five order blocks with the figma copy and no extra form fields (QO)', () => {
    const template = readSource('src/packages/member/membership-order/index.wxml')
    const pageConfig = readSource('src/packages/member/membership-order/index.json')

    expect(pageConfig).toContain('"navigationBarTitleText": "订单确认"')
    // 商品卡
    expect(template).toContain('>年卡<')
    expect(template).toContain('MIP 玩家会员')
    expect(template).toContain('{{planTitle}}')
    expect(template).toContain('解锁人才合作、机会发布等玩家专属权益')
    expect(template).toContain('有效期')
    expect(template).toContain('{{validityText}}')
    expect(template).toContain('等级经验')
    expect(template).toContain('做任务升级，规则见「玩家等级」页')
    // 订单ID / 价格明细 / 购买须知 / 底部支付
    expect(template).toContain('订单ID')
    expect(template).toContain('价格明细')
    expect(template).toContain('玩家会员年费')
    expect(template).toContain('{{feeText}}')
    expect(template).toContain('总计')
    expect(template).toContain('购买须知')
    expect(template).toContain('立即支付')
    expect(template).toContain('mip-liquid-glass')
    // 订单确认页无补充填写项（2026-09-21 终审 QO）
    expect(template).not.toMatch(/<(input|textarea|picker|picker-view|switch|slider|checkbox|radio|form|t-input|t-textarea|t-picker|t-switch|t-slider|t-radio-group|t-checkbox-group)\b/)
  })

  it('keeps the amount server-decided and pays through the commerce module only', () => {
    const script = readSource('src/packages/member/membership-order/index.ts')
    const template = readSource('src/packages/member/membership-order/index.wxml')

    // 金额来自服务端会员方案（C7 的 ¥6600/年是线上目录配置，前端不得写死价格）。
    expect(script).toContain('plan.priceCents')
    expect(script).not.toContain('6600')
    expect(template).not.toContain('6600')
    expect(script).toContain('mipCommerceModule.listPlans')
    expect(script).toContain('mipCommerceModule.purchase')
    expect(script).toContain('idempotencyKey: createIntentKey(\'membership-order\')')
    // 页面不得直接拉起支付（金额、发货、退款由 ledger 与回调决定）。
    expect(script).not.toContain('wx.requestPayment')
    expect(template).not.toContain('requestPayment')
  })

  it('gates payment behind identity and lands on the mine tab after success', () => {
    const script = readSource('src/packages/member/membership-order/index.ts')

    expect(script).toContain('action: \'PURCHASE_MEMBERSHIP\'')
    expect(script).toContain('mipAccessPageUrl(session.token)')
    expect(script).toContain('consumePendingResume(\'packages/member/membership-order/index\')')
    // 支付成功（含账本确认中）→ 我的页；取消停留本页且不改变权益。
    expect(script).toContain('caseSwitchPrimary(\'/pages/profile/index\')')
    expect(script).toContain('outcome.kind === \'CANCELLED\'')
    expect(script).toContain('支付已取消，会员权益未发生变化。')
  })

  it('blocks payment when a cached plan render is not verified by a fresh fetch (P1)', () => {
    const script = readSource('src/packages/member/membership-order/index.ts')
    const template = readSource('src/packages/member/membership-order/index.wxml')

    // 对齐旧会员页 plansVerified 守卫：缓存只用来先出内容，未经服务端刷新确认不得支付。
    expect(script).toContain('plansVerified: false')
    expect(script).toContain('this.applyPlans(cached, false)')
    expect(script).toContain('this.applyPlans(plans, true)')
    expect(script).toMatch(/catch \{[\s\S]*?plansVerified: false[\s\S]*?会员方案更新失败，暂时无法支付。/)
    expect(script).toMatch(/if \(!planId \|\| !this\.data\.plansVerified \|\| this\.data\.state !== 'ready'/)
    // 按钮禁用与文案一致（刷新失败时不可发起购买）。
    expect(template).toContain('disabled="{{paying || !plansVerified}}"')
    expect(template).toContain('aria-disabled="{{paying || !plansVerified}}"')
  })

  it('resumes the purchase intent on show regardless of the current render state', () => {
    const script = readSource('src/packages/member/membership-order/index.ts')

    // 对齐旧会员页：慢网络下缓存渲染尚未 ready 也不丢续购意图（planId 已在 pay() 时捕获）。
    expect(script).toContain('if (resume?.action === \'PURCHASE_MEMBERSHIP\' && this.resumePlanId) {')
    expect(script).not.toContain('resume?.action === \'PURCHASE_MEMBERSHIP\' && this.resumePlanId && this.data.state')
  })

  it('keeps no dead order-id copy affordance (order id renders after payment only)', () => {
    const script = readSource('src/packages/member/membership-order/index.ts')
    const template = readSource('src/packages/member/membership-order/index.wxml')

    // 订单号支付后由订单列表展示，本页无复制入口（删除 copyOrderId 死代码）。
    expect(script).not.toContain('copyOrderId')
    expect(script).not.toContain('orderIdText')
    expect(template).not.toContain('copyOrderId')
    expect(template).not.toContain('orderIdText')
    expect(template).toContain('{{orderNumberText}}')
  })
})
