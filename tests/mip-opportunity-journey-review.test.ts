import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

/**
 * journey-review WS-OPPORTUNITIES（2026-09-21 终审稿）验收点。
 * 覆盖：机会 Tab 四角色口径、Banner 位、机会类型黄标、项目状态三态、
 * 访客/发布人详情底部条、mine 列表长按删除与下架置灰。
 */
describe('MIP opportunity journey review', () => {
  const discovery = source('src/pages/opportunities/index.wxml')
  const discoveryScript = source('src/pages/opportunities/index.ts')
  const card = source('src/components/mip-opportunity-card/index.wxml')
  const cardScript = source('src/components/mip-opportunity-card/index.ts')
  const cardStyles = source('src/components/mip-opportunity-card/index.wxss')
  const detail = source('src/packages/member/mip-opportunities/detail/index.wxml')
  const detailStyles = source('src/packages/member/mip-opportunities/detail/index.wxss')
  const editor = source('src/packages/member/mip-opportunities/editor/index.wxml')
  const editorScript = source('src/packages/member/mip-opportunities/editor/index.ts')
  const mine = source('src/packages/member/mip-opportunities/mine/index.wxml')
  const mineScript = source('src/packages/member/mip-opportunities/mine/index.ts')
  const catalog = source('src/modules/mip-opportunities/catalog.ts')

  it('renames the sub tabs and status pills to the final wording (J2-05)', () => {
    expect(discovery).toContain('>项目机会<')
    expect(discovery).toContain('>人才合作<')
    expect(discovery).not.toContain('机会搜索')
    expect(discovery).not.toContain('>已完成<')
    expect(discovery).toContain('data-status="COMPLETED"')
    expect(discovery).toContain('>已结束</view>')
    expect(discovery).toContain('data-status="MINE"')
    expect(discovery).toContain('>我的项目</view>')
    expect(discovery).toContain('>发布机会</text>')
  })

  it('keeps all guest trigger points behind the identity sheet (J1-04/J1-05)', () => {
    // 玩家登录 / 去成为玩家解锁权限 仅游客态（!authenticated）渲染。
    expect(discovery).toContain(`wx:elif="{{!authenticated}}"`)
    expect(discovery).toContain('bind:tap="openLogin">玩家登录')
    // J1-06→J1-07：解锁入口走 openProtected 门禁，授权后落玩家等级页（不再原地刷新）。
    expect(discovery).toContain('bind:tap="openBecomePlayerUnlock">去成为玩家解锁权限>')
    expect(discoveryScript).toContain(`void this.openProtected('/packages/member/mip-growth/index', 'ENTER_APP')`)
    // 发布机会 / 筛选走 openProtected；游客点「我的项目」先身份确认，回来后落在我的项目 pill。
    expect(discoveryScript).toContain(`void this.openProtected(url, 'PUBLISH_OPPORTUNITY')`)
    expect(discoveryScript).toContain(`void this.openProtected(FILTER_AUTH_RESUME, 'INTERACT')`)
    expect(discoveryScript).toContain(`if (status === 'MINE' && !this.data.authenticated)`)
    expect(discoveryScript).toContain(`const MINE_AUTH_RESUME = 'auth-intent:open-mine'`)
    expect(discoveryScript).toContain(`if (destination === MINE_AUTH_RESUME)`)
    // 游客在人才合作子 tab 点搜索也先授权。
    expect(discovery).toContain(`wx:if="{{!authenticated}}" class="absolute inset-y-0 left-0 right-[176rpx]"`)
    expect(discovery).toContain('placeholder="搜索玩家名称"')
  })

  it('shows the member empty states without the guest login block (J2-05/J2-07)', () => {
    expect(discovery).toContain('暂无平台机会')
    expect(discovery).toContain('暂无人才数据')
    expect(discovery).toContain('src="/assets/figma/opportunities/guest-mystery-box.png"')
    // 带筛选的空态保留可操作的清筛选入口。
    expect(discovery).toContain('没有找到相关机会')
    expect(discovery).toContain('没有找到人才')
  })

  it('renders the inline my-projects pill with the welcome empty state (J2-06)', () => {
    expect(discoveryScript).toContain('opportunityModule.listMine(')
    expect(discoveryScript).toContain(`this.data.status === 'MINE'`)
    expect(discovery).toContain('欢迎发布项目机会，有匹配的资源')
    expect(discovery).toContain('或人才MIP将主动联系你')
    expect(discovery).toContain('bind:tap="publish">发布机会</view>')
  })

  it('mounts the operations banner slot below the navigation (J3-01)', () => {
    expect(discoveryScript).toContain(`import { mipBannerModule } from '../../modules/mip-banners'`)
    expect(discoveryScript).toContain('mipBannerModule.listActive(force)')
    expect(discoveryScript).toContain('openBanner(event: WechatMiniprogram.TouchEvent)')
    expect(discovery).toContain('bind:tap="openBanner"')
    // 未配置不占位：banner 容器以 banners.length 为渲染条件，且复用活动页 swiper 尺寸。
    expect(discovery).toContain(`wx:if="{{mode === 'opportunities' && banners.length}}"`)
    expect(discovery).toContain('h-[298rpx]')
  })
  it('adds the QZ1 type trio as optional card props with unchanged defaults', () => {
    // 三件套取值集固定，无「早知院」「找 freelancer」。
    expect(catalog).toContain(`{ key: 'COMPANY', label: '找企业' }`)
    expect(catalog).toContain(`{ key: 'RESOURCE', label: '找资源' }`)
    expect(catalog).toContain(`{ key: 'PARTNER', label: '找伙伴' }`)
    for (const banned of ['早知院', 'freelancer']) {
      expect(catalog).not.toContain(banned)
      expect(editor).not.toContain(banned)
    }
    // 黄标 46x20（92x40rpx）黄底黑字 r4；全部新属性可选、默认不渲染。
    expect(cardScript).toContain(`typeTags: { type: Array, value: [] as OpportunityTypeTagView[] }`)
    expect(cardScript).toContain(`pillLabel: { type: String, value: '想合作' }`)
    expect(cardScript).toContain(`cityText: { type: String, value: '' }`)
    expect(cardScript).toContain(`publishedPrefix: { type: String, value: '发布于 ' }`)
    expect(card).toContain('wx:if="{{typeTags.length}}"')
    expect(card).toContain('wx:if="{{cityText}}"')
    expect(card).toContain('城市：{{cityText}}')
    expect(cardStyles).toContain('height: 40rpx;')
    expect(cardStyles).toContain('border-radius: 8rpx;')
    // 机会 Tab 传黄标与想合作聚合，旧调用方（首页/我的页）不传新属性不受影响。
    expect(discovery).toContain('type-tags="{{item.typeTagViews}}"')
    expect(discovery).toContain('pill-label="想合作"')
  })

  it('presents the visitor detail bar with the cooperation aggregate pill (J3-09)', () => {
    expect(detail).toContain('published-prefix="发表于："')
    expect(detail).toContain('city-text="{{item.city.label || \'\'}}"')
    expect(detail).toContain('type-tags="{{typeTagViews}}"')
    expect(detail).toContain('bind:tap="cooperationIntent"')
    expect(detail).toContain('{{item.cooperationCount || 0}}想合作</text>')
    // 招募结束的详情底部合作按钮不可点，文案「项目已结束」。
    expect(detail).toContain(`wx:elif="{{!item.mine && item.status === 'ENDED'}}"`)
    expect(detail).toContain('aria-disabled="true">项目已结束</view>')
  })

  it('keeps share enabled for recruiting and ended, disabled for unpublished (J4-05/J4-06)', () => {
    expect(detail).toContain('open-type="share" aria-role="button">分享机会</button>')
    expect(detail).toContain(`wx:elif="{{ownerBar === 'unpublished'}}"`)
    expect(detail).toContain('aria-disabled="true" disabled>分享机会</button>')
    // 下架禁用态为 scene-specific 色值（#2C2C2C/#333/#666）。
    expect(detailStyles).toContain('color: #666;')
    expect(detailStyles).toContain('background: #2c2c2c;')
    expect(detailStyles).toContain('border: 2rpx solid #333;')
    expect(detail).toContain('bind:tap="edit"')
  })

  it('collects the QZ1 trio and QZ2 status in the editor (J4-04)', () => {
    expect(editor).toContain('机会类型')
    expect(editor).toContain('wx:for="{{typeOptions}}"')
    expect(editor).toContain('border border-brand bg-panel text-[28rpx] text-brand')
    expect(editorScript).toContain('typeKeys: this.data.typeOptions.filter(item => item.selected).map(item => item.key)')
    expect(editorScript).toContain('publicationStatus:')
    expect(editorScript).toContain('项目已下架')
    expect(editor).not.toContain('即将支持')
    expect(editor).toContain('aria-disabled="{{item.disabled}}"')
    expect(editor).toContain('你希望项目被谁看到')
    expect(editor).toContain('发布到平台，让更多人看到')
    expect(editor).toContain('仅希望 MIP 内部玩家看到')
    expect(editor).toContain('项目封面（选填）')
    expect(editor).toContain('主营地区（选填）')
    expect(editor).toContain('示例：南山十亩地')
    expect(editor).toContain('{{targetSummary.length}}/300')
    expect(editor).toContain('{{description.length}}/300')
    // J4-04 原型明确为选填；输入框保留 300 字上限。
    expect(editor).toContain('<text>展开讲讲（选填）</text>')
    // 项目状态行去重：区块标题保留一份，收起行只显示当前值。
    expect(editor.match(/项目状态<\/text>/g)?.length).toBe(1)
    // 编辑页不出现删除入口（C5：删除归我的项目长按）。
    expect(editor).not.toContain('删除机会')
  })

  it('supports long-press delete with the native modal and greyed-out unpublished cards (J6-03)', () => {
    expect(mine).toContain('发布机会')
    expect(mine).toContain('我想合作')
    expect(mine).not.toContain('发布机会 {{publishedItems.length}}')
    expect(mine).not.toContain('我想合作 {{cooperatingItems.length}}')
    expect(mine).toContain('bindlongpress="confirmDeletePublished"')
    expect(mineScript).toContain('删除后将无法恢复，是否删除？')
    expect(mineScript).toContain(`confirmColor: '#FF4D5E'`)
    // C5 口径与其余四处一致：弹窗标题「删除提示」、toast success 1.8s。
    expect(mineScript).toContain(`title: '删除提示'`)
    expect(mineScript).not.toContain(`title: '删除机会'`)
    expect(mineScript).toContain(`title: '已删除', icon: 'success', duration: 1800`)
    expect(mineScript).toContain(`dimmed: label === '已下架'`)
    expect(mine).toContain(`{{item.dimmed ? 'opacity-50 grayscale' : ''}}`)
    // mine 列表卡片保持现行样式：不传机会类型黄标新属性。
    expect(mine).not.toContain('mip-opportunity-card')
    expect(mine).not.toContain('type-tags=')
    // 空态文案与发布入口。
    expect(mine).toContain('欢迎发布项目机会')
    expect(mine).toContain('有匹配的资源或人才MIP将主动联系你')
  })
})
