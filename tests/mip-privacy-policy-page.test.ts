import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function agreement(overrides: Partial<{ isDemo: boolean, body: string, version: number }>) {
  return { title: '隐私政策', body: '', isDemo: true, version: 0, updatedAt: '', ...overrides }
}

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const loadAgreement = vi.hoisted(() => vi.fn())
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: { getMembershipAgreement: loadAgreement } }))
vi.mock('../src/modules/mip-identity/runtime', () => ({ mipGlobalAccessGuard: { leaveDocument: vi.fn() } }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: { recordCustomerServiceInteraction: vi.fn() } }))

interface PageDefinition {
  data: Record<string, unknown>
  [key: string]: unknown
}

let definition: PageDefinition

function createPage() {
  const page = Object.create(definition) as PageDefinition
  page.data = structuredClone(definition.data)
  page.setData = (patch: Record<string, unknown>) => Object.assign(page.data, patch)
  return page
}

async function callLoad(page: PageDefinition) {
  await (page.loadPrivacyPolicy as () => Promise<void>)()
}

beforeAll(async () => {
  vi.stubGlobal('Page', (value: unknown) => {
    definition = value as PageDefinition
  })
  await import('../src/packages/member/privacy-policy/index')
  vi.unstubAllGlobals()
})

beforeEach(() => {
  loadAgreement.mockReset()
})

describe('privacy policy page (MIW-121)', () => {
  it('keeps the standalone static policy when the backend has no configured document', async () => {
    loadAgreement.mockResolvedValue(agreement({ isDemo: true, body: '' }))
    const page = createPage()
    await callLoad(page)
    expect(page.data.mode).toBe('static')
    expect(loadAgreement).toHaveBeenCalledExactlyOnceWith('privacy')
  })

  it('switches to the configured document view only for non-demo server content', async () => {
    loadAgreement.mockResolvedValue(agreement({ isDemo: false, body: '后台正式隐私政策全文', version: 6 }))
    const page = createPage()
    await callLoad(page)
    expect(page.data.mode).toBe('document')
    expect(page.data.agreement).toMatchObject({ body: '后台正式隐私政策全文', version: 6 })
  })

  it('falls back to the static policy when the document request fails', async () => {
    loadAgreement.mockRejectedValue(new Error('network down'))
    const page = createPage()
    await callLoad(page)
    expect(page.data.mode).toBe('static')
  })

  it('keeps both render modes explicit and preserves the verbatim static copy', () => {
    const view = read('src/packages/member/privacy-policy/index.wxml')
    // 互斥渲染态显式列出，禁止裸 else 兜底吞掉未来新增排除态。
    expect(view).toContain('wx:if="{{mode === \'document\'}}"')
    expect(view).toContain('wx:elif="{{mode === \'static\'}}"')
    expect(view).not.toMatch(/<block wx:else/)
    // 静态政策逐字保留（未配置时视觉与历史版本一致）。
    expect(view).toContain('更新日期：{{effectiveDate}}')
    expect(view).toContain('信息处理范围')
    expect(view).toContain('仅在使用对应功能时处理微信身份标识')
    expect(view).toContain('id="mip-privacy-policy-page"')
    // 两种渲染态都保留客服入口。
    expect(view.match(/open-type="contact"/g)).toHaveLength(2)
  })
})
