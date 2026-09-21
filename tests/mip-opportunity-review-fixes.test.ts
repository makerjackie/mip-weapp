import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { journeyStatusOf } from '../src/modules/mip-opportunities/catalog'
import { parseOpportunityPage } from '../src/modules/mip-opportunities/validation'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

/**
 * WS-OPPORTUNITIES 首轮 review 修复回归（2026-09-22）。
 * 覆盖：#1 下架链路不再对服务端撒谎、#2 恢复路径刷新登录态、
 * #3 展开讲讲必填呈现、#4 regionText 取值链、#9 typeKeys 全非法过滤。
 */
describe('MIP opportunity review fixes', () => {
  const discoveryScript = source('src/pages/opportunities/index.ts')
  const discovery = source('src/pages/opportunities/index.wxml')
  const editorScript = source('src/packages/member/mip-opportunities/editor/index.ts')
  const detailScript = source('src/packages/member/mip-opportunities/detail/index.ts')
  const detail = source('src/packages/member/mip-opportunities/detail/index.wxml')
  const mine = source('src/packages/member/mip-opportunities/mine/index.wxml')
  const card = source('src/components/mip-opportunity-card/index.wxml')
  const cardScript = source('src/components/mip-opportunity-card/index.ts')
  const catalogSource = source('src/modules/mip-opportunities/catalog.ts')

  it('keeps journeyStatusOf boundaries with the unreachable unpublish fallback annotated (#1)', () => {
    // 行为边界：DRAFT+publishedAt 保留「已下架」回退；其余状态原样返回。
    expect(journeyStatusOf({ status: 'DRAFT', publishedAt: '2026-01-01T00:00:00.000Z' })).toBe('UNPUBLISHED')
    expect(journeyStatusOf({ status: 'DRAFT' })).toBe('DRAFT')
    expect(journeyStatusOf({ status: 'DRAFT', publishedAt: '' })).toBe('DRAFT')
    expect(journeyStatusOf({ status: 'PUBLISHED', publishedAt: '2026-01-01T00:00:00.000Z' })).toBe('PUBLISHED')
    expect(journeyStatusOf({ status: 'ENDED' })).toBe('ENDED')
    // 注释必须声明该分支当前服务端不可达（保存对已发布机会 publish:false 仍落 PUBLISHED）。
    expect(catalogSource).toContain('不可达')
    // 保存路径不再接受 UNPUBLISHED、不再宣称「已下架」；反馈按服务端真实返回状态决定。
    expect(editorScript).not.toContain(`projectStatus !== 'UNPUBLISHED'`)
    expect(editorScript).not.toContain('项目已下架')
    expect(editorScript).toContain(`title: result.status === 'PUBLISHED' ? '机会已发布' : '草稿已保存'`)
    // J4-06 详情置灰渲染分支保留（数据就绪即生效）。
    expect(detailScript).toContain(`? 'unpublished'`)
  })

  it('refreshes auth state before resuming the pending destination on show (#2)', () => {
    const onShow = discoveryScript.slice(
      discoveryScript.indexOf('  onShow() {'),
      discoveryScript.indexOf('  async loadBanners(force = false) {'),
    )
    expect(onShow).toContain('consumePendingResume')
    const abandonIndex = onShow.indexOf('this.abandonLoginSheet()')
    const refreshIndex = onShow.indexOf('void this.refreshAuthState()')
    const runIndex = onShow.indexOf('this.runResumeDestination(destination)')
    // setData/调用顺序：清弹层 → 刷新登录态 → 恢复原意图（与 onLoginSheetPhone 对齐）。
    expect(abandonIndex).toBeGreaterThanOrEqual(0)
    expect(refreshIndex).toBeGreaterThan(abandonIndex)
    expect(runIndex).toBeGreaterThan(refreshIndex)
  })

  it('restores the required description presentation to match server validation (#3)', () => {
    const view = source('src/packages/member/mip-opportunities/editor/index.wxml')
    const descriptionBlock = view.slice(
      view.indexOf('id="opportunity-field-description"'),
      view.indexOf('id="opportunity-field-roles"'),
    )
    expect(descriptionBlock).toContain('<text>展开讲讲</text>')
    expect(descriptionBlock).not.toContain('（选填）')
    expect(descriptionBlock).toContain('>必填</text>')
    expect(descriptionBlock).toContain('aria-label="展开讲讲，必填"')
  })

  it('renders regionText first with the existing location fallbacks intact (#4)', () => {
    // 卡片取值链：regionText 优先 → locationText（调用方 locationDisplay 兜底）→ cityText。
    expect(cardScript).toContain(`regionText: { type: String, value: '' }`)
    expect(card).toContain('地区：{{regionText || locationText || cityText}}')
    // 详情/机会 Tab/mine 列表都透传 regionText，服务端将来回传即生效。
    expect(detail).toContain(`region-text="{{item.regionText || ''}}"`)
    expect(discovery).toContain(`region-text="{{item.regionText || ''}}"`)
    expect(mine).toContain('{{item.regionText || item.commercialTerms.locationDisplay')
    // 无数据时不劣化：城市名兜底链保持现状。
    expect(detail).toContain(`location-text="{{item.commercialTerms.locationDisplay || item.city.label || item.branchName || '全国'}}"`)
    expect(discovery).toContain(`location-text="{{item.commercialTerms.locationDisplay || item.city.label || item.branchName || '全国'}}"`)
  })

  it('strips all-invalid typeKeys arrays instead of rendering them as tags (#9)', () => {
    const mixed = parseOpportunityPage({ items: [{ id: 'a', typeKeys: ['BOGUS', 'COMPANY', 'BOGUS'] }] })
    expect(mixed.items[0]?.typeKeys).toEqual(['COMPANY'])
    const allInvalid = parseOpportunityPage({ items: [{ id: 'b', typeKeys: ['BOGUS', 'NOPE'] }] })
    expect(allInvalid.items[0]?.typeKeys).toEqual([])
    const absent = parseOpportunityPage({ items: [{ id: 'c' }] })
    expect(absent.items[0]?.typeKeys).toBeUndefined()
  })

  it('disables the ended edit entry and keeps the aggregate avatars on a white ring (#5/#7)', () => {
    // ENDED 详情「编辑」置灰不可点（服务端 OWNER_EDITABLE 不含 ENDED）。
    expect(detail).toContain(`wx:elif="{{ownerBar === 'ended'}}"`)
    const endedBlock = detail.slice(
      detail.indexOf(`wx:elif="{{ownerBar === 'ended'}}"`),
      detail.indexOf(`<view wx:else class="flex h-[88rpx] w-[176rpx]`),
    )
    expect(endedBlock).toContain('aria-disabled="true"')
    expect(endedBlock).not.toContain('bind:tap="edit"')
    // 点击兜底：已结束不再跳编辑页。
    expect(detailScript).toContain(`item.status !== 'ENDED'`)
    // 访客「+n想合作」24px 头像白描边（对齐 mip-attend-pill）。
    expect(detail).toContain('rounded-full border-[2rpx] border-solid border-white')
    expect(detail).not.toContain('border-solid border-panel-raised')
  })
})
