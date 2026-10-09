import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePublicProfileAggregate } from '../src/modules/mip-opportunities/validation'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

/**
 * MIW-55（figma 3675:6828 / 3675:6640 / 3675:6984 / 3675:7012 / 3359:5705）：
 * 机会卡片与设计稿五态对齐——正常、0想合作、+1想合作、机会详情、下架。
 * 卡片几何 351x176（702x352rpx）、r8 卡角 r4 封面、城市行 building 图标、
 * 底行黄标居左 / 想合作胶囊居右且 0 想合作不渲染、下架卡封面图标置灰 + 灰胶囊。
 */
describe('MIW-55 opportunity card alignment', () => {
  const card = source('src/components/mip-opportunity-card/index.wxml')
  const cardScript = source('src/components/mip-opportunity-card/index.ts')
  const cardStyles = source('src/components/mip-opportunity-card/index.wxss')
  const pillStyles = source('src/components/mip-attend-pill/index.wxss')
  const profilePage = source('src/packages/member/mip-public-profile/index.wxml')
  const profileScript = source('src/packages/member/mip-public-profile/index.ts')
  const discovery = source('src/pages/opportunities/index.wxml')
  const myPage = source('src/pages/profile/index.wxml')
  const detail = source('src/packages/member/mip-opportunities/detail/index.wxml')

  it('keeps the figma card silhouette: r8 card corner and r4 cover corner', () => {
    expect(cardStyles).toMatch(/\.mip-opportunity-card\s*\{[^}]*border-radius: var\(--mip-radius-card-small\);/)
    expect(cardStyles).toMatch(/\.mip-opportunity-card__cover\s*\{[^}]*border-radius: 8rpx;/)
  })

  it('moves the city row to the building icon and the footer to centered alignment', () => {
    expect(card).toContain('/assets/figma/opportunities/city-building.svg')
    expect(cardStyles).toMatch(/\.mip-opportunity-card__footer\s*\{[^}]*align-items: center;/)
    // 胶囊由 __pill 包裹推到右下，黄标留在左下（3675:6828 两端对齐）。
    expect(cardStyles).toMatch(/\.mip-opportunity-card__pill\s*\{[^}]*margin-left: auto;/)
    expect(card).toContain('class="mip-opportunity-card__pill"')
  })

  it('hides the aggregate pill when nobody wants to cooperate (3675:6640)', () => {
    expect(card).toContain('wx:if="{{variant !== \'detail\' && referralCount > 0}}"')
  })

  it('renders the offline (unpublished) card gray without city row or type tag (3675:7012)', () => {
    expect(cardScript).toContain(`status: { type: String, value: 'PUBLISHED' }`)
    expect(cardScript).toMatch(/offline: value === 'UNPUBLISHED' \|\| value === 'DRAFT'/)
    expect(card).toContain('{{offline ? \'mip-opportunity-card--offline\' : \'\'}}')
    expect(card).toContain('wx:if="{{cityText && !offline}}"')
    expect(card).toContain('wx:if="{{typeTags.length && !offline}}"')
    expect(card).toContain('variant="{{offline ? \'gray\' : \'yellow\'}}"')
    // 下架卡封面置灰、图标转 #b3b3b3。
    expect(cardStyles).toMatch(/\.mip-opportunity-card--offline \.mip-opportunity-card__cover-image[^{]*\{[^}]*filter: grayscale\(1\);/)
    expect(cardStyles).toMatch(/\.mip-opportunity-card--offline \.mip-opportunity-card__icon\s*\{[^}]*filter: grayscale\(1\) brightness\(0\.84\);/)
    expect(pillStyles).toMatch(/\.mip-attend-pill--gray\s*\{[^}]*background: var\(--mip-text-secondary\);/)
  })

  it('swaps the public-profile related-opportunities tab to the shared card (3359:5705)', () => {
    expect(profilePage).toContain('<mip-opportunity-card')
    expect(profilePage).toContain('status="{{item.status}}"')
    expect(profilePage).toContain('type-tags="{{item.typeTagViews}}"')
    expect(profilePage).toContain('avatars="{{item.avatarViews}}"')
    expect(profilePage).not.toContain('人想合作</text>')
    expect(profileScript).toContain('typeTagViews: (item.typeKeys || []).map(key => ({ key, label: opportunityTypeLabel(key) }))')
    expect(source('src/packages/member/mip-public-profile/index.json')).toContain('"mip-opportunity-card": "/components/mip-opportunity-card/index"')
  })

  it('threads the status into all three opportunity lists and the detail card', () => {
    expect(discovery).toContain('status="{{item.status}}"')
    expect(myPage.match(/status="\{\{item\.status\}\}"/g)).toHaveLength(2)
    expect(detail).toContain('status="{{item.status}}"')
  })

  it('parses aggregate typeKeys and avatars tolerantly for legacy servers', () => {
    const base = {
      profile: {
        profileRef: 'p1.abcdef123456',
        nickname: '大鹅飞飞',
        isSelf: false,
        userKind: 'PLAYER',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
      cooperationCards: [],
      superCases: [],
      interestActive: false,
    }
    const legacy = parsePublicProfileAggregate({
      ...base,
      opportunities: [{
        id: '60000000-0000-4000-8000-000000000001',
        title: '设计户外过两天再说露营地',
        valueSummary: '15000',
        targetSummary: '露营地帐篷供应商',
        referralCount: 0,
        status: 'PUBLISHED',
        publishedAt: '2026-01-04T13:00:00.000Z',
      }],
    })
    expect(legacy.opportunities[0].typeKeys).toBeUndefined()
    expect(legacy.opportunities[0].avatars).toBeUndefined()

    const enhanced = parsePublicProfileAggregate({
      ...base,
      opportunities: [{
        id: '60000000-0000-4000-8000-000000000001',
        title: '设计户外过两天再说露营地',
        valueSummary: '15000',
        targetSummary: '露营地帐篷供应商',
        referralCount: 4,
        cooperationCount: 4,
        typeKeys: ['RESOURCE', 'BOGUS'],
        avatars: ['cloud://a', '', 42],
        status: 'PUBLISHED',
        publishedAt: '2026-01-04T13:00:00.000Z',
      }],
    })
    expect(enhanced.opportunities[0].typeKeys).toEqual(['RESOURCE'])
    expect(enhanced.opportunities[0].avatars).toEqual(['cloud://a'])

    // G4：referrals 与发布列表同 DTO 同校验；旧服务端缺省按空数组（chip 计数 0 + 空态），
    // 新服务端畸形列表整页拒绝。
    expect(parsePublicProfileAggregate({ ...base, opportunities: [] }).referrals).toEqual([])
    expect(parsePublicProfileAggregate({
      ...base,
      opportunities: [],
      referrals: [{
        id: '60000000-0000-4000-8000-000000000002',
        title: '引荐的机会',
        valueSummary: '15000',
        targetSummary: '露营地帐篷供应商',
        referralCount: 0,
        status: 'PUBLISHED',
        publishedAt: '2026-01-05T13:00:00.000Z',
      }],
    }).referrals[0]).toMatchObject({ id: '60000000-0000-4000-8000-000000000002', title: '引荐的机会', cooperationCount: 0 })
    expect(() => parsePublicProfileAggregate({ ...base, opportunities: [], referrals: 'x' })).toThrow()
    expect(() => parsePublicProfileAggregate({ ...base, opportunities: [], referrals: [{ id: 'broken' }] })).toThrow()
  })

  it('selects type keys and returns avatars from the public profile aggregate', () => {
    const discoveryDomain = source('cloudfunctions/mip-opportunities-api/domain/discovery.js')
    expect(discoveryDomain).toContain('o.type_keys_json')
    // 2026-10-08 端到端验收回归修复：jsonObject 对数组/NULL 兜底返回 {}（对象），
    // `.filter` 会让历史行崩掉整个聚合接口；契约钉住 arrayOrEmpty 直接收口。
    // （MIW-58 分支同点独立修复，注释合并。）
    expect(discoveryDomain).toContain(`typeKeys: arrayOrEmpty(item.type_keys_json).filter(key => typeof key === 'string')`)
    expect(discoveryDomain).toContain('avatars: cooperation.get(item.id)?.avatars || []')
  })
})
