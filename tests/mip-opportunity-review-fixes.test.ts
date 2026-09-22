import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { journeyStatusOf } from '../src/modules/mip-opportunities/catalog'
import { parseOpportunityPage } from '../src/modules/mip-opportunities/validation'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

const mocks = vi.hoisted(() => ({
  consumePendingResume: vi.fn(),
  loadSnapshot: vi.fn(),
  beginProtectedAction: vi.fn(),
  cancel: vi.fn(),
  listActive: vi.fn(),
  getCatalogs: vi.fn(),
  listOpportunities: vi.fn(),
  listMine: vi.fn(),
  listTalents: vi.fn(),
  navigateTo: vi.fn(),
  syncCaseNavigation: vi.fn(),
}))

vi.mock('../src/config/brand', () => ({ brand: { productName: 'MIP', logoPath: '/assets/logo.png' } }))
vi.mock('../src/config/mip-catalogs', () => ({ cooperationRoles: [] }))
vi.mock('../src/components/catalog-selector/model', () => ({
  catalogSelectorView: () => ({ viewGroups: [], popularOptions: [] }),
}))
vi.mock('../src/modules/mip-banners', () => ({ mipBannerModule: { listActive: mocks.listActive } }))
vi.mock('../src/modules/mip-cooperation', () => ({ cooperationModule: { listTalents: mocks.listTalents } }))
vi.mock('../src/modules/mip-cooperation/validation', () => ({
  mergeCooperationTalents: (current: unknown) => current,
}))
vi.mock('../src/modules/mip-identity', () => ({
  mipAccessPageUrl: (token: string) => `/packages/member/mip-access/index?token=${token}`,
}))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: {
    consumePendingResume: mocks.consumePendingResume,
    loadSnapshot: mocks.loadSnapshot,
    beginProtectedAction: mocks.beginProtectedAction,
    cancel: mocks.cancel,
  },
}))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: { getCatalogs: mocks.getCatalogs, list: mocks.listOpportunities, listMine: mocks.listMine },
  groupedCityBranches: () => [],
  opportunityTypeLabel: (key: string) => key,
}))
vi.mock('../src/platform/navigation/client', () => ({
  caseNavigateTo: mocks.navigateTo,
  syncCaseNavigation: mocks.syncCaseNavigation,
}))

let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/pages/opportunities/index')
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.consumePendingResume.mockReturnValue(null)
  mocks.loadSnapshot.mockResolvedValue({ authenticated: false })
  mocks.beginProtectedAction.mockResolvedValue({
    token: 't0',
    intent: { action: 'INTERACT' },
    snapshot: { authenticated: false },
    decision: { ready: false },
  })
})

function discoveryPage() {
  const instance = Object.create(definition)
  instance.data = { ...definition.data }
  instance.setData = (value: Record<string, unknown>) => Object.assign(instance.data, value)
  return instance
}

/**
 * WS-OPPORTUNITIES review 修复回归（2026-09-22，二轮终修）。
 * 覆盖：#1 下架链路不再对服务端撒谎、#2/B1 恢复路径等登录态刷新（行为级断言）、
 * #3 展开讲讲必填呈现、#4 regionText 取值链（含首页/我的页透传）、#9 typeKeys 过滤。
 */
describe('MIP opportunity review fixes', () => {
  const discovery = source('src/pages/opportunities/index.wxml')
  const home = source('src/pages/index/index.wxml')
  const profile = source('src/pages/profile/index.wxml')
  const editorScript = source('src/packages/member/mip-opportunities/editor/index.ts')
  const editorView = source('src/packages/member/mip-opportunities/editor/index.wxml')
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
    // 二轮终修：收起行只剩两态（UNPUBLISHED 在半屏置灰不可选，「下架项目」分支不可达）。
    expect(editorView).toContain(`{{projectStatus === 'RECRUITING' ? '招募中' : '结束项目'}}`)
    expect(editorView).not.toContain(`'下架项目'}}`)
  })

  it('waits for the refreshed auth snapshot before resuming the pending destination (#2/B1)', async () => {
    mocks.consumePendingResume.mockReturnValue({ action: 'INTERACT', source: { navigation: 'navigateBack' } })
    let releaseSnapshot: ((snapshot: { authenticated: boolean }) => void) | undefined
    mocks.loadSnapshot.mockImplementation(() => new Promise((resolve) => {
      releaseSnapshot = resolve
    }))
    const instance = discoveryPage()
    instance.resumeDestination = 'auth-intent:open-filters'
    const authenticatedAtResume: boolean[] = []
    const runResumeDestination = instance.runResumeDestination.bind(instance)
    instance.runResumeDestination = (destination: string) => {
      authenticatedAtResume.push(instance.data.authenticated)
      runResumeDestination(destination)
    }
    const pending = instance.onShow()
    // 快照返回前不得恢复原意图：旧实现在此处已用过期 authenticated（false）跑完恢复，
    // 导致 FILTER 哨兵二次触发身份确认、跳非法页面静默失败。
    expect(authenticatedAtResume).toEqual([])
    releaseSnapshot?.({ authenticated: true })
    await pending
    expect(authenticatedAtResume).toEqual([true])
    expect(instance.data.filterOpen).toBe(true)
  })

  it('runs an auth-intent sentinel in place when the protected action is already ready (B1 double guard)', async () => {
    mocks.beginProtectedAction.mockResolvedValue({
      token: 't1',
      intent: { action: 'INTERACT' },
      snapshot: { authenticated: true },
      decision: { ready: true },
    })
    const instance = discoveryPage()
    await instance.openProtected('auth-intent:open-filters', 'INTERACT')
    // 哨兵不是页面路径：ready 时就地恢复并同步登录态，绝不当 URL 跳转。
    expect(mocks.navigateTo).not.toHaveBeenCalled()
    expect(instance.data.authenticated).toBe(true)
    expect(instance.data.filterOpen).toBe(true)
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
    // 详情/机会 Tab/mine 列表/首页信息流/我的页都透传 regionText，服务端将来回传即生效。
    expect(detail).toContain(`region-text="{{item.regionText || ''}}"`)
    expect(discovery).toContain(`region-text="{{item.regionText || ''}}"`)
    expect(home).toContain(`region-text="{{item.regionText || ''}}"`)
    expect(profile).toContain(`region-text="{{item.regionText || ''}}"`)
    expect(mine).toContain('{{item.regionText || item.commercialTerms.locationDisplay')
    // 无数据时不劣化：城市名兜底链保持现状。
    expect(detail).toContain(`location-text="{{item.commercialTerms.locationDisplay || item.city.label || item.branchName || '全国'}}"`)
    expect(discovery).toContain(`location-text="{{item.commercialTerms.locationDisplay || item.city.label || item.branchName || '全国'}}"`)
    expect(home).toContain(`location-text="{{item.commercialTerms.locationDisplay || item.city.label || item.branchName || '全国'}}"`)
    expect(profile).toContain(`location-text="{{item.commercialTerms.locationDisplay || item.city.label || item.branchName || '全国'}}"`)
  })

  it('strips malformed typeKeys values instead of leaving them for consumers to map over (#9)', () => {
    const mixed = parseOpportunityPage({ items: [{ id: 'a', typeKeys: ['BOGUS', 'COMPANY', 'BOGUS'] }] })
    expect(mixed.items[0]?.typeKeys).toEqual(['COMPANY'])
    const allInvalid = parseOpportunityPage({ items: [{ id: 'b', typeKeys: ['BOGUS', 'NOPE'] }] })
    expect(allInvalid.items[0]?.typeKeys).toEqual([])
    const malformed = parseOpportunityPage({ items: [{ id: 'd', typeKeys: 'COMPANY' }] })
    expect(malformed.items[0]?.typeKeys).toEqual([])
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
