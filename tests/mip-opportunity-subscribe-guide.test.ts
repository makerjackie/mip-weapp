import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pageSource = () => readSource('src/packages/member/mip-opportunities/detail/index.ts')
const viewSource = () => readSource('src/packages/member/mip-opportunities/detail/index.wxml')

describe('MIP opportunity subscribe guide wiring (MIW-40)', () => {
  it('mounts a single self-hiding guide instance on the detail page', () => {
    const config = JSON.parse(readSource('src/packages/member/mip-opportunities/detail/index.json'))
    expect(config.usingComponents['mip-subscription-guide']).toBe('/components/mip-subscription-guide/index')
    const view = viewSource()
    expect(view).toContain('<mip-subscription-guide id="opportunity-subscribe-guide" template-key="OPPORTUNITY_NOTICE" opportunity-id="{{id}}" />')
    // 常驻挂载在页面根部：不依赖 state 条件块的渲染时序
    expect(view.indexOf('<mip-subscription-guide')).toBeGreaterThan(view.indexOf('</t-popup>'))
  })

  it('checks the guide only after the current action completes (S1/S2/S3)', () => {
    const page = pageSource()
    // 门槛：仅发布人；组件内部还有模板/节奏门控
    const guideMethod = page.match(/checkSubscriptionGuide\(\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(guideMethod).toContain('if (!this.data.item?.mine)')
    expect(guideMethod).toContain(`selectComponent('#opportunity-subscribe-guide')`)
    // S1/S2：详情加载完成后检查；编辑返回复用 onShow→load 同一入口，edit() 本身不拦截
    const loadMethod = page.match(/async load\(\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(loadMethod).toContain('this.checkSubscriptionGuide()')
    expect(page.match(/edit\(\) \{[\s\S]*?\n {2}\},/)?.[0] || '').not.toContain('checkSubscriptionGuide')
    // S3：想合作名单弹层关闭后检查
    const closeHandler = page.match(/handleCooperatorsVisibility\([\s\S]*?\n {2}\},/)?.[0] || ''
    expect(closeHandler).toContain('this.closeCooperators()')
    expect(closeHandler).toContain('this.checkSubscriptionGuide()')
    expect(page.match(/this\.checkSubscriptionGuide\(\)/g)).toHaveLength(2)
  })

  it('keeps the native panel inside the guide layer only', () => {
    const page = pageSource()
    expect(page).not.toContain('requestSubscribeMessage')
    expect(page).not.toContain('requestWechatSubscription')
    const component = readSource('src/components/mip-subscription-guide/index.ts')
    expect(component).toContain('mipMessagingModule.requestWechatSubscription')
    expect(component).toMatch(/async request\(\)/)
    // attached 只回读节奏记录，不发起授权请求
    const lifetimes = component.match(/lifetimes:\s*\{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(lifetimes).toContain('normalizeGuideRecord')
    expect(lifetimes).not.toContain('requestWechatSubscription')
    const componentView = readSource('src/components/mip-subscription-guide/index.wxml')
    expect(componentView).toContain('bind:tap="request"')
    expect(componentView).toContain('bind:tap="dismiss"')
  })

  it('writes a publish pending on success and consumes it on landing pages (S8)', () => {
    // 编辑器：仅在发布成功（PUBLISHED）时写 pending；草稿保存/下架不写
    const editor = readSource('src/packages/member/mip-opportunities/editor/index.ts')
    const save = editor.match(/async save\(publish: boolean\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(save).toContain(`publish && result.status === 'PUBLISHED'`)
    expect(save).toContain('writePendingGuideOpportunity(result.id, Date.now())')
    expect(save).toContain('wx.setStorageSync(GUIDE_PENDING_STORAGE_KEY, pending)')

    // 主落地：我的机会列表 onShow 一次性消费 pending，ID 走参数传入
    const mine = readSource('src/packages/member/mip-opportunities/mine/index.ts')
    const onShow = mine.match(/onShow\(\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(onShow).toContain('this.checkPendingSubscriptionGuide()')
    const consume = mine.match(/checkPendingSubscriptionGuide\(\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(consume).toContain('readPendingGuideOpportunity')
    expect(consume).toContain('wx.removeStorageSync(GUIDE_PENDING_STORAGE_KEY)')
    expect(consume).toContain(`selectComponent('#opportunity-mine-subscribe-guide')`)
    expect(consume).toContain('?.check(pending)')
    expect(mine).not.toContain('requestWechatSubscription')
    const mineConfig = JSON.parse(readSource('src/packages/member/mip-opportunities/mine/index.json'))
    expect(mineConfig.usingComponents['mip-subscription-guide']).toBe('/components/mip-subscription-guide/index')
    expect(readSource('src/packages/member/mip-opportunities/mine/index.wxml'))
      .toContain('<mip-subscription-guide id="opportunity-mine-subscribe-guide" template-key="OPPORTUNITY_NOTICE" opportunity-id="" />')

    // 兜底落地：详情页只清 pending，展示仍由 S1 检查负责（不重复弹）
    const guideMethod = pageSource().match(/checkSubscriptionGuide\(\) \{[\s\S]*?\n {2}\},/)?.[0] || ''
    expect(guideMethod).toContain('wx.removeStorageSync(GUIDE_PENDING_STORAGE_KEY)')
    expect(guideMethod).toContain('if (!this.data.item?.mine)')
  })

  it('records the new template key in the env example and the delivery contract', () => {
    expect(readSource('.env.example')).toContain('OPPORTUNITY_NOTICE')
    expect(readSource('docs/NOTIFICATIONS.md')).toContain('OPPORTUNITY_NOTICE')
  })
})
