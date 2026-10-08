import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

/**
 * journey-review WS-OPPORTUNITIES（2026-09-21 终审稿）验收点。
 * 覆盖：机会 Tab 四角色口径、Banner 位、机会类型黄标、项目状态三态、
 * 访客/发布人详情底部条、档案页「相关机会」栏长按删除。
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
    expect(discoveryScript).toContain(`void this.openProtected('/packages/member/mip-growth/index', 'VIEW_RESTRICTED_PROFILE')`)
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
    // MIW-18：项目机会与人才合作两个 Tab 共用同一 Banner，仅以 banners.length 控制。
    expect(discovery).toContain(`wx:if="{{banners.length}}"`)
    expect(discovery).not.toContain(`mode === 'opportunities' && banners.length`)
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
    // figma 机会详情（访客视角）：液态玻璃 bar 左侧为共享 mip-attend-pill「+N想合作」。
    expect(detail).toMatch(/<mip-attend-pill\s+count="\{\{item\.cooperationCount\}\}"\s+label="想合作"/)
    // 招募结束的详情底部合作按钮不可点，文案「项目已结束」。
    expect(detail).toContain(`wx:elif="{{!item.mine && item.status === 'ENDED'}}"`)
    expect(detail).toContain('label="项目已结束" disabled')
  })

  it('keeps share enabled for recruiting and ended, disabled for unpublished (J4-05/J4-06)', () => {
    expect(detail).toContain('label="分享机会" openType="share"')
    expect(detail).toContain(`wx:elif="{{ownerBar === 'unpublished'}}"`)
    expect(detail).toContain('label="分享机会" disabled')
    // 下架禁用态收编 mip-pill-button（组件内 disabled 样式），页面不再持有 scene-specific 色值。
    expect(detailStyles).not.toContain('opportunity-share-button')
    expect(detail).toContain('bind:tap="edit"')
  })

  it('collects the QZ1 trio and QZ2 status in the editor (J4-04)', () => {
    expect(editor).toContain('机会类型')
    expect(editor).toContain('wx:for="{{typeOptions}}"')
    // figma 3359:6086：三件套渲染为行卡（黄圈单选形、多选语义），未选中圈用品牌色描边。
    expect(editor).toContain('rounded-[16rpx] bg-panel px-[16rpx]" aria-role="checkbox" aria-checked="{{item.selected}}"')
    expect(editor).toContain('rounded-full border-[2rpx] border-solid border-brand')
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
    // figma 3359:6086：示例文案更新为观澜古墟。
    expect(editor).toContain('示例：观澜古墟')
    expect(editor).toContain('{{targetSummary.length}}/300')
    expect(editor).toContain('{{description.length}}/300')
    // J4-04 原型明确为选填；输入框保留 300 字上限。
    expect(editor).toContain('<text>展开讲讲（选填）</text>')
    // 项目状态行去重：区块标题保留一份，收起行显示 projectStatusText。
    expect(editor.match(/项目状态<\/text>/g)?.length).toBe(1)
    expect(editor).toContain('{{projectStatusText}}')
    expect(editorScript).toContain('projectStatusTextOf(projectStatus)')
    // 编辑页不出现删除入口（C5：删除归我的项目长按）。
    expect(editor).not.toContain('删除机会')
  })

  it('supports long-press delete with the native modal from the profile portfolio (J6-03)', () => {
    // 2026-10-07：「我的机会」独立页删除后，J6-01~03 长按删除统一落在
    // 「我的」档案页「相关机会」栏（发布机会/我想合作两栏）。
    const profileTemplate = source('src/pages/profile/index.wxml')
    const profileScript = source('src/pages/profile/index.ts')
    expect(profileTemplate).toContain('>发布机会</view>')
    expect(profileTemplate).toContain('>我想合作</view>')
    expect(profileTemplate).toContain('bind:longpress="deleteOpportunity"')
    expect(profileScript).toContain(`deletePortfolioItem('opportunities', String(event.currentTarget.dataset.id || ''))`)
    expect(profileScript).toContain('删除后将无法恢复，是否删除？')
    expect(profileScript).toContain(`confirmColor: '#FF4D5E'`)
    // MIW-54（2026-10-08）：弹窗标题带对象类型（取代 C5 通用「删除提示」），内容带卡片名区分同栏多张卡。
    expect(profileScript).toContain(`'删除合作卡'`)
    expect(profileScript).toContain(`'删除超级案例'`)
    expect(profileScript).toContain(`'删除机会'`)
    expect(profileScript).toContain('」删除后将无法恢复，是否删除？')
    expect(profileScript).toContain(`title: '已删除', icon: 'success', duration: 1800`)
    // 删除确认后卡片先置灰再移除；已下架态改由详情页/编辑器承载。
    expect(profileTemplate).toContain(`removingPortfolioId === item.id ? 'opacity-50' : ''`)
    expect(profileTemplate).toContain('<mip-opportunity-card')
    // 空态文案与发布入口。
    expect(profileTemplate).toContain('暂无相关机会，发布后会显示在这里。')
    expect(profileTemplate).toContain('bind:tap="openOpportunityEditor"')
  })
})
